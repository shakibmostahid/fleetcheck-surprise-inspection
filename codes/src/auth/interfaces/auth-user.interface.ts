/** The logged-in admin, attached to the request by BasicAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
}
