// Entry point of the cinnamon command (bin/cinnamon runs this with Bun).
import { Cli } from './Cli';

if (import.meta.main) {
  new Cli().main(process.argv.slice(2)).then((code) => process.exit(code ?? 0), (e) => { console.error(e); process.exit(1); });
}
