export type ContentSafetyCode =
  | "phone"
  | "email"
  | "address_like"
  | "coordinates"
  | "medical_detail"
  | "length";

export interface ContentSafetyWarning {
  code: ContentSafetyCode;
  message: string;
  span?: { start: number; end: number };
}

const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const COORD_RE = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;
const POSTCODE_HOUSE_RE =
  /\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*,?\s*(?:flat|apt|apartment|unit|#)?\s*\d+[a-z]?\b/gi;
const APARTMENT_RE =
  /\b(?:flat|apartment|apt|unit)\s*#?\s*\d+[a-z]?\b/gi;
const MEDICAL_RE =
  /\b(?:medical\s+record|patient\s+id|nhs\s+number|diagnosis\s+of|prescription\s+for|blood\s+type)\b/gi;

function pushMatches(
  text: string,
  re: RegExp,
  code: ContentSafetyCode,
  message: string,
  out: ContentSafetyWarning[],
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({
      code,
      message,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }
}

/**
 * Offline content safety: flags probable PII / high-risk phrases.
 * Does not strip or mutate text — caller decides presentation.
 */
export class ContentSafetyPolicy {
  inspectText(text: string): ContentSafetyWarning[] {
    const warnings: ContentSafetyWarning[] = [];
    pushMatches(
      text,
      PHONE_RE,
      "phone",
      "Possible phone number in public text",
      warnings,
    );
    pushMatches(
      text,
      EMAIL_RE,
      "email",
      "Possible email address in public text",
      warnings,
    );
    pushMatches(
      text,
      COORD_RE,
      "coordinates",
      "Possible latitude/longitude pair in public text",
      warnings,
    );
    pushMatches(
      text,
      POSTCODE_HOUSE_RE,
      "address_like",
      "Possible postcode with house/apartment number",
      warnings,
    );
    pushMatches(
      text,
      APARTMENT_RE,
      "address_like",
      "Possible apartment/unit number",
      warnings,
    );
    pushMatches(
      text,
      MEDICAL_RE,
      "medical_detail",
      "Possible explicit medical record detail",
      warnings,
    );
    return warnings;
  }

  inspectEventTexts(texts: string[]): ContentSafetyWarning[] {
    return texts.flatMap((t) => this.inspectText(t));
  }
}
