'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireAdminAction, type AdminContext } from '@/lib/admin-action';
import { supabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { inviteFormInput, inviteSchema, roleSchema, uuidSchema } from '@/lib/validation';
import { parseAdminUsers, userStatus } from '@/lib/admin-overview';
import {
  checkInviteQuota,
  describeAdminRpcError,
  describeInviteError,
  guardBlock,
  guardRoleChange,
  inviteWindowStart,
  type ActionResult,
  type InviteState,
} from '@/lib/admin-users';

// Server akcije admin panela (2.5.6). Svaka počinje sa requireAdminAction() i proverom ulaza (zod).
// Promene uloge i blokade idu kroz admin_* funkcije u bazi (proveravaju admina + aal2 i same upisuju audit),
// a poziv i Auth ban kroz Auth Admin API (supabaseAdmin). Redosled: baza prva (ona odlučuje ko sme),
// pa tek onda Auth.

// Oko 100 godina: Auth ban nema "trajno", a odblokada šalje 'none'
const BAN_DURATION = '876000h';
const INVALID_REQUEST = 'Neispravan zahtev.';
const NOT_FOUND = 'Nalog nije pronađen.';

// Broj poslatih poziva u poslednja 24 sata. Čita se preko admin sesije (RLS + aal2 daju adminu ceo audit log).
// null = upit nije uspeo, a to ne sme da otvori slanje.
async function invitesSentRecently(admin: AdminContext): Promise<number | null> {
  const { count, error } = await admin.supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'user_invited')
    .gte('created_at', inviteWindowStart(new Date()).toISOString());
  if (error) {
    console.error('Invite Quota Error:', error.code);
    return null;
  }
  return count;
}

// Poziv i ponovno slanje: ista kvota, isti poziv Auth-u, isti audit zapis.
async function sendInvite(
  admin: AdminContext,
  email: string,
  fullName: string | null,
  resent: boolean,
): Promise<{ error: string } | { success: true }> {
  const quota = checkInviteQuota(await invitesSentRecently(admin));
  if (!quota.ok) return { error: quota.error };

  // Trigger handle_new_user pravi profil sa ulogom lawyer; javna registracija je isključena, ali Admin API radi
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    email,
    fullName ? { data: { full_name: fullName } } : undefined,
  );
  if (error || !data?.user) {
    console.error('Invite Error:', error?.code, error?.status);
    return { error: describeInviteError(error) };
  }

  await logAudit({ id: admin.user.id, email: admin.user.email }, 'user_invited', {
    resourceType: 'user',
    resourceId: data.user.id,
    metadata: resent ? { email, resent: true } : { email },
    ip: getClientIp(await headers()),
  });
  return { success: true };
}

export async function inviteLawyer(_previous: InviteState, formData: FormData): Promise<InviteState> {
  const raw = inviteFormInput(formData);
  const values = {
    email: typeof raw.email === 'string' ? raw.email : '',
    fullName: typeof raw.fullName === 'string' ? raw.fullName : '',
  };

  const auth = await requireAdminAction();
  if ('error' in auth) return { status: 'error', error: auth.error, values };

  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { status: 'error', error: parsed.error.issues[0]?.message ?? INVALID_REQUEST, values };

  const result = await sendInvite(auth.admin, parsed.data.email, parsed.data.fullName, false);
  if ('error' in result) return { status: 'error', error: result.error, values };

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  return { status: 'success', message: `Poziv je poslat na ${parsed.data.email}.` };
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if ('error' in auth) return auth;
  if (!uuidSchema.safeParse(userId).success) return { error: NOT_FOUND };

  // Adresa se uzima iz baze, a ne od klijenta: ovom akcijom se ne može poslati poziv na proizvoljnu adresu
  const { data, error } = await auth.admin.supabase.rpc('admin_list_users');
  if (error) {
    console.error('Resend Invite List Error:', error.code);
    return { error: describeAdminRpcError(error) };
  }
  const users = parseAdminUsers(data);
  if (!users) return { error: describeAdminRpcError(null) };

  const target = users.find((u) => u.id === userId);
  if (!target) return { error: NOT_FOUND };
  if (userStatus(target, new Date()) !== 'invited') {
    return { error: 'Poziv se ponovo šalje samo nalogu koji još nije postavio lozinku.' };
  }

  const result = await sendInvite(auth.admin, target.email, target.fullName?.trim() || null, true);
  if ('error' in result) return result;
  return { success: true, message: `Poziv je ponovo poslat na ${target.email}.` };
}

export async function disableLawyer(userId: string): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if ('error' in auth) return auth;
  if (!uuidSchema.safeParse(userId).success) return { error: NOT_FOUND };

  const blocked = guardBlock(auth.admin.user.id, userId);
  if (blocked) return { error: blocked };

  // 1. Oznaka u bazi (važi odmah, i za još važeći token), uz audit zapis user_disabled
  const { error: flagError } = await auth.admin.supabase.rpc('admin_set_disabled', { p_user_id: userId, p_disabled: true });
  if (flagError) {
    console.error('Disable User Error:', flagError.code);
    return { error: describeAdminRpcError(flagError) };
  }

  // 2. Ban u Auth-u: sprečava prijavu i osvežavanje sesije
  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION });
  if (banError) {
    console.error('Ban User Error:', banError.code, banError.status);
    return { error: 'Nalog je blokiran u aplikaciji, ali blokada prijave nije uspela. Pokušajte ponovo.' };
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  return { success: true, message: 'Nalog je blokiran.' };
}

export async function enableLawyer(userId: string): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if ('error' in auth) return auth;
  if (!uuidSchema.safeParse(userId).success) return { error: NOT_FOUND };

  // 1. Oznaka u bazi (baza prva: ona odlučuje da li je pozivalac admin), uz audit zapis user_enabled
  const { error: flagError } = await auth.admin.supabase.rpc('admin_set_disabled', { p_user_id: userId, p_disabled: false });
  if (flagError) {
    console.error('Enable User Error:', flagError.code);
    return { error: describeAdminRpcError(flagError) };
  }

  // 2. Skidanje bana u Auth-u. Ako ne uspe, nalog i dalje ne može da se prijavi (ban ostaje), pa je ponovni pokušaj bezbedan
  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (banError) {
    console.error('Unban User Error:', banError.code, banError.status);
    return { error: 'Oznaka blokade je uklonjena, ali skidanje blokade prijave nije uspelo. Pokušajte ponovo.' };
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  return { success: true, message: 'Nalog je odblokiran.' };
}

export async function setRole(userId: string, role: string): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if ('error' in auth) return auth;
  if (!uuidSchema.safeParse(userId).success) return { error: NOT_FOUND };

  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { error: parsedRole.error.issues[0]?.message ?? INVALID_REQUEST };

  const own = guardRoleChange(auth.admin.user.id, userId);
  if (own) return { error: own };

  // Poslednjeg aktivnog admina čuva baza (23514); promena uloge se beleži u audit log u istoj transakciji
  const { error } = await auth.admin.supabase.rpc('admin_set_role', { p_user_id: userId, p_role: parsedRole.data });
  if (error) {
    console.error('Set Role Error:', error.code);
    return { error: describeAdminRpcError(error) };
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  return {
    success: true,
    message: parsedRole.data === 'admin' ? 'Nalog je postavljen za admina.' : 'Nalog je vraćen na ulogu advokata.',
  };
}
