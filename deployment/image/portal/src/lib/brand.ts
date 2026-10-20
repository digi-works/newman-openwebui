/** Per-customer branding. Read on the server at request time so one image serves every customer. */
export type Brand = { name: string; org: string; initial: string; host: string };

export function getBrand(): Brand {
  const name = process.env.BRAND_NAME || "Ask Digi";
  return {
    name,
    org: process.env.BRAND_ORG || "Newman University",
    initial: name.trim().charAt(0).toUpperCase(),
    host: process.env.BRAND_HOST || "newman.digiworks.ai",
  };
}
