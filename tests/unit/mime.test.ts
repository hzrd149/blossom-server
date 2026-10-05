import { assertEquals } from "@std/assert";
import { isActiveContentMime } from "../../src/utils/mime.ts";

const cases: ReadonlyArray<{
  name: string;
  value: string | null | undefined;
  expected: boolean;
}> = [
  { name: "absent value", value: undefined, expected: false },
  { name: "null value", value: null, expected: false },
  { name: "empty value", value: "", expected: false },
  { name: "HTML", value: "text/html", expected: true },
  {
    name: "mixed-case parameterized HTML",
    value: " Text/HTML ; charset=UTF-8",
    expected: true,
  },
  { name: "text XML", value: "text/xml", expected: true },
  { name: "application XML", value: "application/xml", expected: true },
  { name: "SVG XML subtype", value: "image/svg+xml", expected: true },
  { name: "XHTML XML subtype", value: "application/xhtml+xml", expected: true },
  { name: "XSLT XML subtype", value: "application/xslt+xml", expected: true },
  { name: "arbitrary XML subtype", value: "application/problem+xml", expected: true },
  { name: "exact multipart mixed replace", value: "multipart/x-mixed-replace", expected: true },
  {
    name: "mixed-case parameterized multipart mixed replace",
    value: " Multipart/X-Mixed-Replace ; boundary=frame",
    expected: true,
  },
  { name: "ordinary multipart form data", value: "multipart/form-data", expected: false },
  { name: "ordinary multipart mixed", value: "multipart/mixed", expected: false },
  { name: "raw octet stream", value: "application/octet-stream", expected: false },
  { name: "ordinary image", value: "image/png", expected: false },
  { name: "JSON", value: "application/json", expected: false },
  { name: "plain text", value: "text/plain", expected: false },
  { name: "XML prefix lookalike", value: "application/xml-extra", expected: false },
  { name: "XML suffix lookalike", value: "application/+xml-extra", expected: false },
  { name: "missing subtype", value: "+xml", expected: false },
];

for (const testCase of cases) {
  Deno.test(`isActiveContentMime: ${testCase.name}`, () => {
    assertEquals(isActiveContentMime(testCase.value), testCase.expected);
  });
}
