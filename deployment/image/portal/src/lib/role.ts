/**
 * Which kind of instance this is. A customer stack (DIGI_ROLE=customer, the default) serves only the customer product. The platform
 * instance (DIGI_ROLE=platform) additionally serves Studio under /platform and /api/platform, and the release service under /api/release.
 * The gate lives in src/proxy.ts: on a customer stack those paths do not exist (404), so a customer cannot even tell Studio is there.
 */
export const isPlatform = () => process.env.DIGI_ROLE === "platform";

export const PLATFORM_PATHS = ["/platform", "/api/platform", "/api/release"];
export const isPlatformPath = (pathname: string) => PLATFORM_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
