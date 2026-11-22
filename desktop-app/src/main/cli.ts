import parseArgs from 'electron-args';

let binaryName = 'Pokefix';

if (process.platform === 'darwin') {
  binaryName = '/Applications/Pokefix.app/Contents/MacOS/Pokefix';
}

if (process.platform === 'win32') {
  binaryName = 'Pokefix.exe';
}

const cli = parseArgs(
  `
      Pokefix
   
      Usage
        $ ${binaryName} [path]
   
      Options
        --help     show help
        --version  show version
   
      Examples
        $ ${binaryName} https://example.com
        $ ${binaryName} /path/to/index.html
  `,
  {
    alias: {
      h: 'help',
    },
  }
);

export default cli;
