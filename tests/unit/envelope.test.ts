import { assertEquals } from "@std/assert";

const mimeModule: Record<string, unknown> = await import("../../src/utils/mime.ts");
const isEnvelopeMime = mimeModule.isEnvelopeMime as
  | ((value: string | null | undefined) => boolean)
  | undefined;

const cases: ReadonlyArray<{
  name: string;
  value: string | null | undefined;
  expected: boolean;
}> = [
  { name: "absent value", value: undefined, expected: false },
  { name: "null value", value: null, expected: false },
  { name: "empty value", value: "", expected: false },
  { name: "raw octet stream", value: "application/octet-stream", expected: false },
  { name: "ordinary image", value: "image/png", expected: false },
  { name: "multipart form data", value: "multipart/form-data", expected: true },
  { name: "mixed-case multipart subtype", value: "  MultiPart/MiXeD  ", expected: true },
  {
    name: "multipart with parameters",
    value: 'multipart/form-data; boundary="blossom-boundary"',
    expected: true,
  },
  {
    name: "mixed-case urlencoded with parameters",
    value: " Application/X-Www-Form-Urlencoded ; charset=UTF-8",
    expected: true,
  },
  {
    name: "similar application subtype",
    value: "application/x-www-form-urlencoded-extra",
    expected: false,
  },
];

for (const testCase of cases) {
  Deno.test(`isEnvelopeMime: ${testCase.name}`, () => {
    assertEquals(isEnvelopeMime?.(testCase.value), testCase.expected);
  });
}
