declare const verifiedTenantIdBrand: unique symbol;

/**
 * A tenant identifier returned only after an authorization boundary has matched the requested
 * tenant to the authenticated identity or its canonical support grant.
 */
export type VerifiedTenantId = string & { readonly [verifiedTenantIdBrand]: true };
