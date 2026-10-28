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
  | 'suspicious_content_flagged';

export type AuditActor = { id: string; email?: string | null };

// Samo brojevi, ID-evi i kratke oznake. Tip namerno ne dozvoljava ugnježdene objekte,
// a baza dodatno ograničava metadata na 4 KB.
type MetadataValue = string | number | boolean | null | string[];

type AuditOptions = {
  resourceType?: 'document' | 'chat';
  resourceId?: string;
  metadata?: Record<string, MetadataValue>;
  ip?: string | null;
};

export async function logAudit(actor: AuditActor, action: AuditAction, options: AuditOptions = {}): Promise<void> {
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
    if (error) console.error('Audit Log Error:', action, error);
  } catch (error) {
    console.error('Audit Log Exception:', action, error);
  }
}
