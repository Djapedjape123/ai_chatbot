import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';

// Audit log (migracija 2.1): ko, kada, šta i ID-evi. NIKAD tekst pitanja, odgovora ni dokumenata.
// Upis ide kroz service_role (append-only, bez UPDATE/DELETE), a greška u upisu ne ruši zahtev.

export type AuditAction =
  | 'document_uploaded'
  | 'document_upload_blocked'
  | 'document_deleted'
  | 'chat_created'
  | 'chat_deleted'
  | 'question_asked'
  | 'limit_reached'
  | 'suspicious_content_flagged'
  // Admin panel (2.5). admin_viewed_user, role_changed i settings_changed upisuju RPC funkcije u bazi,
  // a ostale server akcije posle uspešnog poziva Auth Admin API-ja.
  | 'user_invited'
  | 'user_disabled'
  | 'user_enabled'
  | 'role_changed'
  | 'settings_changed'
  | 'admin_viewed_user'
  | 'audit_exported'
  | 'mfa_enrolled'
  // Upisuje okidač u bazi (2.5.11) kad se obriše potvrđen MFA faktor; aplikacija ga ne upisuje, samo prikazuje.
  | 'mfa_removed';

export type AuditActor = { id: string; email?: string | null };

// Samo brojevi, ID-evi i kratke oznake. Tip namerno ne dozvoljava ugnježdene objekte,
// a baza dodatno ograničava metadata na 4 KB.
type MetadataValue = string | number | boolean | null | string[];

type AuditOptions = {
  resourceType?: 'document' | 'chat' | 'user' | 'settings';
  resourceId?: string;
  metadata?: Record<string, MetadataValue>;
  ip?: string | null;
};

// Upisuje zapis i javlja da li je upisan. Za radnje koje se ne smeju izvršiti bez traga (CSV izvoz, 2.5.7):
// pozivalac pri neuspehu odbija radnju. Greška se nikad ne baca.
export async function writeAudit(actor: AuditActor, action: AuditAction, options: AuditOptions = {}): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      user_id: actor.id,
      actor_email: actor.email ?? null,
      action,
      resource_type: options.resourceType ?? null,
      resource_id: options.resourceId ?? null,
      metadata: options.metadata ?? {},
      ip: options.ip ?? null,
    });
    if (error) {
      console.error('Audit Log Error:', action, error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Audit Log Exception:', action, error);
    return false;
  }
}

// Za sve ostale radnje zapis je prateći: neuspeh upisa ne ruši zahtev
export async function logAudit(actor: AuditActor, action: AuditAction, options: AuditOptions = {}): Promise<void> {
  await writeAudit(actor, action, options);
}
