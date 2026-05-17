export type TranslationRequest = {
  text: string;
  sourceLocale?: string;
  targetLocale: string;
};

export async function translateMessage({ text }: TranslationRequest) {
  return {
    text,
    provider: "passthrough",
    confidence: 1
  };
}
