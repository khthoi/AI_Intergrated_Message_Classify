export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  chatgpt: {
    apiKey: process.env.CHATGPT_API_KEY ?? '',
    model: process.env.CHATGPT_MODEL ?? 'gpt-4o-mini',
  },
  reportOutputDir: process.env.REPORT_OUTPUT_DIR ?? './reports',
});
