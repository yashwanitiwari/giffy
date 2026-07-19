#![no_std]

use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, Bytes, BytesN, Env, Map,
    symbol_short,
};

mod errors;
mod storage;
mod types;

#[cfg(test)]
mod test;

use errors::GiftEscrowError;
use storage::{get_gift as storage_get_gift, next_gift_id, set_gift};
use types::{ClaimCondition, GiftRecord, GiftStatus};

#[contract]
pub struct GiftEscrowContract;

#[contractimpl]
impl GiftEscrowContract {
    pub fn create_gift(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        initial_amount: i128,
        expires_at: u64,
        condition: ClaimCondition,
        step_unlocker: Address,
        message_hash: BytesN<32>,
    ) -> u64 {
        sender.require_auth();

        if initial_amount <= 0 {
            panic_with_error!(&env, GiftEscrowError::InvalidContributionAmount);
        }
        if expires_at <= env.ledger().timestamp() {
            panic_with_error!(&env, GiftEscrowError::InvalidExpiry);
        }

        let token_client = token::TokenClient::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &initial_amount);

        let mut contributions: Map<Address, i128> = Map::new(&env);
        contributions.set(sender.clone(), initial_amount);

        let id = next_gift_id(&env);
        let gift = GiftRecord {
            sender: sender.clone(),
            receiver,
            token,
            total_amount: initial_amount,
            contributions,
            expires_at,
            status: GiftStatus::Open,
            condition,
            steps_completed: 0,
            step_unlocker,
            message_hash,
        };
        set_gift(&env, id, &gift);

        env.events()
            .publish((symbol_short!("gift_crtd"), id), (sender, initial_amount));
        id
    }

    pub fn contribute(env: Env, contributor: Address, gift_id: u64, amount: i128) {
        contributor.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, GiftEscrowError::InvalidContributionAmount);
        }

        let mut gift = storage_get_gift(&env, gift_id);
        Self::assert_open_and_unexpired(&env, &gift);

        let token_client = token::TokenClient::new(&env, &gift.token);
        token_client.transfer(&contributor, &env.current_contract_address(), &amount);

        let existing = gift.contributions.get(contributor.clone()).unwrap_or(0);
        gift.contributions.set(contributor.clone(), existing + amount);
        gift.total_amount += amount;

        set_gift(&env, gift_id, &gift);
        env.events()
            .publish((symbol_short!("gift_ctrb"), gift_id), (contributor, amount));
    }

    pub fn unlock_step(env: Env, unlocker: Address, gift_id: u64) {
        unlocker.require_auth();

        let mut gift = storage_get_gift(&env, gift_id);
        if unlocker != gift.step_unlocker {
            panic_with_error!(&env, GiftEscrowError::NotAuthorizedUnlocker);
        }

        let total = match gift.condition {
            ClaimCondition::StepGate(t) => t,
            _ => panic_with_error!(&env, GiftEscrowError::NotStepGated),
        };
        if gift.steps_completed >= total {
            panic_with_error!(&env, GiftEscrowError::AllStepsAlreadyComplete);
        }

        gift.steps_completed += 1;
        let steps_completed = gift.steps_completed;
        set_gift(&env, gift_id, &gift);
        env.events()
            .publish((symbol_short!("gift_step"), gift_id), steps_completed);
    }

    pub fn claim(env: Env, gift_id: u64, claimant: Address, answer: Option<Bytes>) {
        claimant.require_auth();

        let mut gift = storage_get_gift(&env, gift_id);
        if claimant != gift.receiver {
            panic_with_error!(&env, GiftEscrowError::NotReceiver);
        }
        Self::assert_open_and_unexpired(&env, &gift);

        match gift.condition.clone() {
            ClaimCondition::None => {}
            ClaimCondition::AnswerHash(expected) => {
                let provided = match answer {
                    Some(bytes) => bytes,
                    None => panic_with_error!(&env, GiftEscrowError::WrongAnswer),
                };
                let computed = env.crypto().sha256(&provided);
                if computed.to_bytes() != expected {
                    panic_with_error!(&env, GiftEscrowError::WrongAnswer);
                }
            }
            ClaimCondition::StepGate(total) => {
                if gift.steps_completed != total {
                    panic_with_error!(&env, GiftEscrowError::StepsNotComplete);
                }
            }
        }

        // checks-effects-interactions: update state before the external transfer
        gift.status = GiftStatus::Claimed;
        let total_amount = gift.total_amount;
        let token_addr = gift.token.clone();
        set_gift(&env, gift_id, &gift);

        let token_client = token::TokenClient::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &claimant, &total_amount);

        env.events()
            .publish((symbol_short!("gift_clmd"), gift_id), claimant);
    }

    pub fn refund(env: Env, gift_id: u64, caller: Address) {
        caller.require_auth();

        let mut gift = storage_get_gift(&env, gift_id);
        let is_sender = caller == gift.sender;
        let is_contributor = gift.contributions.contains_key(caller.clone());
        if !is_sender && !is_contributor {
            panic_with_error!(&env, GiftEscrowError::NotSenderOrContributor);
        }
        if gift.status != GiftStatus::Open {
            panic_with_error!(&env, GiftEscrowError::GiftNotOpen);
        }
        if env.ledger().timestamp() < gift.expires_at {
            panic_with_error!(&env, GiftEscrowError::GiftNotYetExpired);
        }

        gift.status = GiftStatus::Refunded;
        let contributions = gift.contributions.clone();
        let token_addr = gift.token.clone();
        set_gift(&env, gift_id, &gift);

        let token_client = token::TokenClient::new(&env, &token_addr);
        for (contributor, amount) in contributions.iter() {
            token_client.transfer(&env.current_contract_address(), &contributor, &amount);
        }

        env.events().publish((symbol_short!("gift_rfnd"), gift_id), ());
    }

    pub fn get_gift(env: Env, gift_id: u64) -> GiftRecord {
        storage_get_gift(&env, gift_id)
    }

    fn assert_open_and_unexpired(env: &Env, gift: &GiftRecord) {
        if gift.status != GiftStatus::Open {
            panic_with_error!(env, GiftEscrowError::GiftNotOpen);
        }
        if env.ledger().timestamp() >= gift.expires_at {
            panic_with_error!(env, GiftEscrowError::GiftExpired);
        }
    }
}
