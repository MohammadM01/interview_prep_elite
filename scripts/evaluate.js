#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArguments() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    }
  }

  return { inputPath, outputPath };
}

async function main() {
  const { inputPath, outputPath } = parseArguments();

  if (!inputPath || !outputPath) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const resolvedOutput = path.resolve(process.cwd(), outputPath);

  try {
    const rawData = await fs.readFile(resolvedInput, 'utf-8');
    const cases = JSON.parse(rawData);

    const result = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      kits: []
    };

    await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
    await fs.writeFile(resolvedOutput, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`Evaluator initialized. Read ${cases.length} cases from ${inputPath}`);
    console.log(`Wrote output structure to ${outputPath}`);
  } catch (error) {
    console.error('Evaluation run failed:', error.message);
    process.exit(1);
  }
}

main();
