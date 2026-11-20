import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

for (const file of ['C:/Users/vinay/Downloads/Report_Format.pdf', 'C:/Users/vinay/Downloads/PPT_Format.pdf']) {
  const parser = new PDFParse({ data: readFileSync(file) });
  const result = await parser.getText();
  console.log('='.repeat(80));
  console.log(file, '| pages:', result.total ?? result.pages?.length);
  console.log('='.repeat(80));
  console.log(result.text);
  await parser.destroy();
}
