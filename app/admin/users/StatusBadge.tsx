import type { UserStatus } from '@/lib/admin-overview';
import { statusLabel } from '@/lib/admin-users';

const STYLES: Record<UserStatus, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
};

export default function StatusBadge({ status }: { status: UserStatus }) {
  return <span className={`inline-block text-xs font-medium rounded-full border px-2 py-0.5 ${STYLES[status]}`}>{statusLabel(status)}</span>;
}
