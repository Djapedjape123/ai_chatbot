import NewPasswordForm from '@/app/components/NewPasswordForm';

// Pozvani advokat stiže ovde sa /auth/confirm (sesija je već uspostavljena). Bez sesije proxy.ts vodi na /login.
export default function SetPasswordPage() {
  return (
    <NewPasswordForm
      title="Postavite lozinku"
      intro="Dobrodošli. Izaberite lozinku kojom ćete se ubuduće prijavljivati."
      submitLabel="Sačuvaj lozinku"
    />
  );
}
