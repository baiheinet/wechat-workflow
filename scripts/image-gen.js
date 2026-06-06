#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { generateCover, generateInline } = require('./lib/imageGen');
const { listTemplates } = require('./lib/templateLoader');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { template: 'minimal', type: 'cover' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template') opts.template = args[++i];
    else if (args[i] === '--cover') { opts.type = 'cover'; opts.title = args[++i]; }
    else if (args[i] === '--inline') { opts.type = 'inline'; opts.description = args[++i]; }
    else if (args[i] === '--desc') opts.description = args[++i];
    else if (args[i] === '--both') { opts.type = 'both'; opts.title = args[++i]; }
    else if (args[i] === '--help') { opts.help = true; }
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  if (opts.help) {
    console.log(`
Usage: node scripts/image-gen.js <mode> [options]

Modes:
  --cover <title>       Generate cover image
  --inline <desc>       Generate inline illustration
  --both <title>        Generate both cover and inline

Options:
  --desc <text>         Description for the image
  --template <name>     Template style (default: minimal)
  --help                Show this help

Templates:
`);
    const tpls = listTemplates();
    tpls.forEach(t => console.log(`  ${t.name} — ${t.label}`));
    process.exit(0);
  }

  const apiKey = process.env.AGNES_API_KEY || '';
  if (!apiKey) {
    console.error('Error: AGNES_API_KEY environment variable not set');
    console.error('Usage: AGNES_API_KEY=sk-xxx node scripts/image-gen.js --cover "title"');
    process.exit(1);
  }

  if (opts.type === 'cover') {
    generateCover(opts.title, opts.description, opts.template).then(result => {
      console.log(`Cover generated: ${result.path}`);
    }).catch(err => {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    });
  } else if (opts.type === 'inline') {
    generateInline(opts.description, opts.template).then(result => {
      console.log(`Inline image generated: ${result.path}`);
    }).catch(err => {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    });
  } else if (opts.type === 'both') {
    Promise.all([
      generateCover(opts.title, opts.description, opts.template),
      generateInline(opts.description || `Illustration for ${opts.title}`, opts.template)
    ]).then(([cover, inline]) => {
      console.log(`Cover generated: ${cover.path}`);
      console.log(`Inline image generated: ${inline.path}`);
    }).catch(err => {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    });
  }
}

main();
