import {
  Args,
  byteToU8,
  u8toByte,
  u64ToBytes,
  bytesToU64,
  stringToBytes,
  bytesToString,
} from '@massalabs/as-types';
import {
  balance,
  Context,
  Address,
  isDeployingContract,
  Storage,
  transferCoins,
  unsafeRandom,
  generateEvent,
  getBytecodeOf,
  createEvent,
  sendMessage,
} from '@massalabs/massa-as-sdk';
import {
  OWNER_KEY,
  _onlyOwner,
} from '@massalabs/sc-standards/assembly/contracts/utils/ownership-internal';

export * from '@massalabs/sc-standards/assembly/contracts/utils/ownership';

// STORAGE KEYS

const FEE = stringToBytes('F'); // 5
const NEXT_FEE = stringToBytes('NF'); // 5
const ENTREE_VALUE = stringToBytes('EV'); // 1 * 10**9
const NEXT_ENTREE_VALUE = stringToBytes('N'); // 1 * 10**9
const JACKPOT_END = stringToBytes('JE');
const JACKPOT_PERIOD = stringToBytes('JP'); // 1 week = 604_800_000
const ENTREE = stringToBytes('E');

// CONSTRUCTOR

export function constructor(bs: StaticArray<u8>): void {
  assert(isDeployingContract());

  const args = new Args(bs);
  const fee = args.nextU8().unwrap();
  const entree = args.nextU64().unwrap();
  const intevalPeriod = args.nextU64().unwrap();
  _launchPool(fee, entree, Context.currentPeriod() + intevalPeriod);
  Storage.set(OWNER_KEY, Context.caller().toString());
  Storage.set(NEXT_ENTREE_VALUE, u64ToBytes(entree));
  Storage.set(NEXT_FEE, u8toByte(fee));
  Storage.set(JACKPOT_PERIOD, u64ToBytes(intevalPeriod));
}

// ADMIN FUNCTIONS

export function updateFee(bs: StaticArray<u8>): void {
  _onlyOwner();

  const args = new Args(bs);
  const fee = args.nextU8().unwrap();
  assert(fee <= 5, 'Fee must be equal or less than 5%');

  Storage.set(NEXT_FEE, u8toByte(fee));
}

export function updateEntreeValue(bs: StaticArray<u8>): void {
  _onlyOwner();

  const args = new Args(bs);
  const entree = args.nextU64().unwrap();
  Storage.set(NEXT_ENTREE_VALUE, u64ToBytes(entree));
}

export function updatePeriod(bs: StaticArray<u8>): void {
  _onlyOwner();

  const args = new Args(bs);
  const period = args.nextU64().unwrap();
  Storage.set(JACKPOT_PERIOD, u64ToBytes(period));
}

export function relaunchPool(bs: StaticArray<u8>): void {
  _onlyOwner();
  const args = new Args(bs);
  const fee = args.nextU8().unwrap();
  const entree = args.nextU64().unwrap();
  const endPeriod = args.nextU64().unwrap();
  assert(
    endPeriod > Context.currentPeriod() + 50,
    'End period must be in the future',
  );
  assert(!Storage.has(ENTREE), 'Winner not found yet');
  _launchPool(fee, entree, endPeriod);
}

function _launchPool(fee: u8, entreeValue: u64, endPeriod: u64): void {
  if (Storage.has(JACKPOT_END)) {
    assert(Context.currentPeriod() > getJackpotEnd(), 'Pool not ended yet');
  }
  Storage.set(FEE, u8toByte(fee));
  Storage.set(ENTREE_VALUE, u64ToBytes(entreeValue));
  Storage.set(JACKPOT_END, u64ToBytes(endPeriod));
  Storage.set(ENTREE, stringToBytes(''));

  // Check for winner 4 period after end time to avoid unsafeRandom() predictability
  const nextPeriod = endPeriod + 4;

  // send message to self to end pool
  sendMessage(
    Context.callee(),
    'endPool',
    nextPeriod,
    1,
    nextPeriod + 20,
    1,
    10_000_000,
    0,
    0,
    [],
  );
  generateEvent(
    `JACKPOT_LAUNCHED End Period : ${endPeriod}, JACKPOT Winner draw at : ${nextPeriod}`,
  );
}

// if autonomous sc error, use this function
export function endPoolManual(_: StaticArray<u8>): void {
  _onlyOwner();
  assert(!isContract(), 'smart contracts cannot play');
  assert(Context.currentPeriod() > getJackpotEnd(), 'Pool not ended yet');
  _endPool();
}

// autonomous sc function
export function endPool(_: StaticArray<u8>): void {
  assert(Context.caller().equals(Context.callee()), 'Autonomous function only');
  _endPool();
}

function _endPool(): void {
  const entree = getEntree();
  //check if someone entered the pool
  if (entree.length > 0) {
    const entreeList = entree.split(',');
    const nbOfEntries = entreeList.length - 1; // last entry is empty (0xABC,0xDEF,)
    const winner = new Address(
      entreeList[i32(abs(unsafeRandom()) % nbOfEntries)],
    );
    assert(winner != new Address(''), 'JACKPOT: No winner found');

    Storage.del(ENTREE);
    const totalAmount = balance() - 1 * 10 ** 9; // keep 1 MASSA for autonomous sc fees & storage fees
    const fee = (getFee() * totalAmount) / 100;
    transferCoins(winner, totalAmount - fee);
    transferCoins(new Address(Storage.get(OWNER_KEY)), fee);
    const event = createEvent('JACKPOT_WINNER', [
      winner.toString(),
      (totalAmount - fee).toString(),
    ]);
    generateEvent(event);
  }
  _launchPool(
    getNextFee(),
    getNextEntreeValue(),
    Context.currentPeriod() + getJackpotPeriod(),
  );
}

// ENDPOINTS

export function enter(_: StaticArray<u8>): void {
  assert(Context.currentPeriod() < getJackpotEnd(), 'Jackpot ended');

  const caller = Context.caller();
  const value = Context.transferredCoins();
  const entreeValue = getEntreeValue();

  assert(value >= entreeValue, 'Value too low');
  assert(
    value % entreeValue == 0,
    'Value must be a multiple of 1 entree price',
  );
  const nbOfEntries = i32(value / entreeValue);
  let entree = getEntree();
  for (let i = 0; i < nbOfEntries; i++) {
    entree += `${caller},`;
  }
  Storage.set(ENTREE, stringToBytes(entree));

  generateEvent(`JACKPOT_ENTER ${caller.toString()} ${value.toString()}`);
}

// HELPERS

function isContract(): bool {
  return (
    Context.caller() !== Context.transactionCreator() &&
    getBytecodeOf(Context.caller()).length > 0
  );
}

function getFee(): u64 {
  return u64(byteToU8(Storage.get(FEE)));
}

function getNextFee(): u8 {
  return byteToU8(Storage.get(NEXT_FEE));
}

function getEntreeValue(): u64 {
  return bytesToU64(Storage.get(ENTREE_VALUE));
}

function getNextEntreeValue(): u64 {
  return bytesToU64(Storage.get(NEXT_ENTREE_VALUE));
}

function getEntree(): string {
  return bytesToString(Storage.get(ENTREE));
}

function getJackpotEnd(): u64 {
  return bytesToU64(Storage.get(JACKPOT_END));
}

function getJackpotPeriod(): u64 {
  return bytesToU64(Storage.get(JACKPOT_PERIOD));
}
