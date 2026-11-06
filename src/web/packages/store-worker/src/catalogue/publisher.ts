import { isReservedPublisher } from "@yunari/extension-api";

/**
 * The publisher a store item is published under, derived from the account and
 * never from the package. A manifest may name one, but the store ignores it:
 * consent and the kill list key on the publisher segment, so a package that
 * could choose its own would be able to claim a name it does not own.
 *
 * Reserved names (`official`, and anything starting with `yunari`) are refused
 * even for an account that would otherwise slug to them.
 */
export function publisherFor(input: {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string;
}):
  | { readonly ok: true; readonly publisher: string }
  | { readonly ok: false; readonly message: string } {
  const candidates = [
    input.displayName ?? "",
    emailLocalPart(input.email),
    input.userId,
  ];
  for (const candidate of candidates) {
    const slug = slugOf(candidate);
    if (slug === "") continue;
    if (isReservedPublisher(slug))
      return {
        ok: false,
        message: `Publisher ${JSON.stringify(slug)} is reserved.`,
      };
    return { ok: true, publisher: slug };
  }
  return {
    ok: false,
    message: "This account has no name that can be its publisher.",
  };
}

/** Lower-kebab: lowercase ASCII letters and digits, one hyphen between runs. */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? email : email.slice(0, at);
}
