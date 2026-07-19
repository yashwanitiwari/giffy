use soroban_sdk::{panic_with_error, symbol_short, Env, Symbol};

use crate::errors::GiftEscrowError;
use crate::types::GiftRecord;

const GIFT_COUNTER: Symbol = symbol_short!("GFT_CNT");

// Persistent storage TTL bump amounts, expressed in ledgers.
const GIFT_TTL_THRESHOLD: u32 = 100_000;
const GIFT_TTL_EXTEND_TO: u32 = 500_000;

fn gift_key(id: u64) -> (Symbol, u64) {
    (symbol_short!("GIFT"), id)
}

pub fn next_gift_id(env: &Env) -> u64 {
    let current: u64 = env.storage().instance().get(&GIFT_COUNTER).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&GIFT_COUNTER, &next);
    next
}

pub fn set_gift(env: &Env, id: u64, gift: &GiftRecord) {
    let key = gift_key(id);
    env.storage().persistent().set(&key, gift);
    // Extend the TTL on every write so long-lived open gifts (e.g. a
    // 30-day expiry) don't have their storage entry archived/evicted
    // before the gift resolves. Bumped on every state-changing call,
    // not just at creation.
    env.storage()
        .persistent()
        .extend_ttl(&key, GIFT_TTL_THRESHOLD, GIFT_TTL_EXTEND_TO);
}

pub fn get_gift(env: &Env, id: u64) -> GiftRecord {
    let key = gift_key(id);
    match env.storage().persistent().get(&key) {
        Some(gift) => gift,
        None => panic_with_error!(env, GiftEscrowError::GiftNotFound),
    }
}

#[allow(dead_code)]
pub fn gift_exists(env: &Env, id: u64) -> bool {
    let key = gift_key(id);
    env.storage().persistent().has(&key)
}
