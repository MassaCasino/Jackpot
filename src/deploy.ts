import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deploySC, WalletClient } from '@massalabs/massa-sc-deployer';
import {
  Args,
  BUILDNET_CHAIN_ID,
  DefaultProviderUrls,
  MAX_GAS_DEPLOYMENT,
  MassaUnits,
} from '@massalabs/massa-web3';

dotenv.config();

const publicApi = DefaultProviderUrls.BUILDNET;

const privKey = process.env.WALLET_PRIVATE_KEY;
if (!privKey) {
  throw new Error('Missing WALLET_PRIVATE_KEY in .env file');
}

const deployerAccount = await WalletClient.getAccountFromSecretKey(privKey);

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(path.dirname(__filename));

(async () => {
  await deploySC(
    publicApi,
    deployerAccount,
    [
      {
        data: readFileSync(path.join(__dirname, 'build', 'vault.wasm')),
        coins: 1n * MassaUnits.oneMassa,
        args: new Args().addU8(5).addU64(1 * 10 ** 9).addU64(604800000),
      },
    ],
    BUILDNET_CHAIN_ID,
    0n,
    MAX_GAS_DEPLOYMENT,
    true,
  );
  process.exit(0);
})();
