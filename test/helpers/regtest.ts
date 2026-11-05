import { RegtestUtils } from 'regtest-client';

const apiURL = process.env['APIURL'];
const url = process.env['ESPLORA_URL'];
const port = process.env['ELECTRUM_PORT'];
if (!apiURL || !url || !port) {
  throw new Error('Run npm test to start a fresh local Tape instance.');
}

export const regtestUtils = new RegtestUtils({ APIURL: apiURL });
export const esploraURL = url;
export const electrumPort = Number(port);
