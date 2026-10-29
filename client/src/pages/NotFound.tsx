import { ButtonLink } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-sm font-semibold text-navy-700">404</p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">The page you are looking for does not exist or has been moved.</p>
      <ButtonLink to="/" className="mt-6">Back to dashboard</ButtonLink>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-sm font-semibold text-red-700">403</p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Access restricted</h1>
      <p className="mt-2 text-sm text-slate-500">Your account does not have permission to open this page. Contact the system administrator if you need access.</p>
      <ButtonLink to="/" className="mt-6" variant="secondary">Back to dashboard</ButtonLink>
    </div>
  );
}
