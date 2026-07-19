#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, Env,
};

use crate::types::ClaimCondition;
use crate::{GiftEscrowContract, GiftEscrowContractClient};

struct TestToken<'a> {
    address: Address,
    admin_client: token::StellarAssetClient<'a>,
    client: token::TokenClient<'a>,
}

fn create_token<'a>(env: &Env, admin: &Address) -> TestToken<'a> {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let address = sac.address();
    TestToken {
        address: address.clone(),
        admin_client: token::StellarAssetClient::new(env, &address),
        client: token::TokenClient::new(env, &address),
    }
}

fn setup<'a>() -> (
    Env,
    GiftEscrowContractClient<'a>,
    TestToken<'a>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = create_token(&env, &admin);

    let contract_id = env.register(GiftEscrowContract, ());
    let client = GiftEscrowContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token.admin_client.mint(&sender, &1_000_000);

    (env, client, token, sender, receiver)
}

fn message_hash(env: &Env) -> soroban_sdk::BytesN<32> {
    soroban_sdk::BytesN::from_array(env, &[7u8; 32])
}

fn later_ts(env: &Env, offset: u64) -> u64 {
    env.ledger().timestamp() + offset
}

#[test]
fn test_create_and_claim_no_condition() {
    let (env, client, token, sender, receiver) = setup();

    let unlocker = sender.clone();
    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &1_000,
        &later_ts(&env, 1_000),
        &ClaimCondition::None,
        &unlocker,
        &message_hash(&env),
    );

    assert_eq!(token.client.balance(&sender), 1_000_000 - 1_000);
    assert_eq!(token.client.balance(&client.address), 1_000);

    client.claim(&gift_id, &receiver, &None);

    assert_eq!(token.client.balance(&receiver), 1_000);
    assert_eq!(token.client.balance(&client.address), 0);

    let gift = client.get_gift(&gift_id);
    assert_eq!(gift.status, crate::types::GiftStatus::Claimed);
}

#[test]
fn test_claim_wrong_trivia_answer_fails() {
    let (env, client, token, sender, receiver) = setup();

    let answer_bytes = Bytes::from_slice(&env, b"banana");
    let expected_hash = env.crypto().sha256(&answer_bytes).to_bytes();

    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &500,
        &later_ts(&env, 1_000),
        &ClaimCondition::AnswerHash(expected_hash),
        &sender,
        &message_hash(&env),
    );

    let wrong_answer = Bytes::from_slice(&env, b"apple");
    let result = client.try_claim(&gift_id, &receiver, &Some(wrong_answer));
    assert!(result.is_err());

    // Gift should remain open after a failed claim attempt.
    let gift = client.get_gift(&gift_id);
    assert_eq!(gift.status, crate::types::GiftStatus::Open);
}

#[test]
fn test_claim_correct_trivia_answer_succeeds() {
    let (env, client, token, sender, receiver) = setup();

    let answer_bytes = Bytes::from_slice(&env, b"banana");
    let expected_hash = env.crypto().sha256(&answer_bytes).to_bytes();

    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &500,
        &later_ts(&env, 1_000),
        &ClaimCondition::AnswerHash(expected_hash),
        &sender,
        &message_hash(&env),
    );

    let correct_answer = Bytes::from_slice(&env, b"banana");
    client.claim(&gift_id, &receiver, &Some(correct_answer));

    assert_eq!(token.client.balance(&receiver), 500);
    let gift = client.get_gift(&gift_id);
    assert_eq!(gift.status, crate::types::GiftStatus::Claimed);
}

#[test]
fn test_step_gate_blocks_until_all_steps_unlocked() {
    let (env, client, token, sender, receiver) = setup();

    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &200,
        &later_ts(&env, 1_000),
        &ClaimCondition::StepGate(3),
        &sender,
        &message_hash(&env),
    );

    // 0/3 steps complete: claim should fail.
    assert!(client.try_claim(&gift_id, &receiver, &None).is_err());

    client.unlock_step(&sender, &gift_id);
    client.unlock_step(&sender, &gift_id);

    // 2/3 steps complete: claim should still fail.
    assert!(client.try_claim(&gift_id, &receiver, &None).is_err());

    client.unlock_step(&sender, &gift_id);

    // 3/3 steps complete: claim should succeed.
    client.claim(&gift_id, &receiver, &None);
    assert_eq!(token.client.balance(&receiver), 200);
}

#[test]
fn test_contribute_increases_total_and_claim_pays_full_pool() {
    let (env, client, token, sender, receiver) = setup();

    let contributor = Address::generate(&env);
    token.admin_client.mint(&contributor, &1_000_000);

    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &300,
        &later_ts(&env, 1_000),
        &ClaimCondition::None,
        &sender,
        &message_hash(&env),
    );

    client.contribute(&contributor, &gift_id, &700);

    let gift = client.get_gift(&gift_id);
    assert_eq!(gift.total_amount, 1_000);
    assert_eq!(gift.contributions.get(sender.clone()).unwrap(), 300);
    assert_eq!(gift.contributions.get(contributor.clone()).unwrap(), 700);

    client.claim(&gift_id, &receiver, &None);
    assert_eq!(token.client.balance(&receiver), 1_000);
}

#[test]
fn test_refund_before_expiry_fails() {
    let (env, client, token, sender, receiver) = setup();

    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &400,
        &later_ts(&env, 1_000),
        &ClaimCondition::None,
        &sender,
        &message_hash(&env),
    );

    let result = client.try_refund(&gift_id, &sender);
    assert!(result.is_err());
}

#[test]
fn test_refund_after_expiry_pays_back_every_contributor() {
    let (env, client, token, sender, receiver) = setup();

    let contributor_a = Address::generate(&env);
    let contributor_b = Address::generate(&env);
    token.admin_client.mint(&contributor_a, &1_000_000);
    token.admin_client.mint(&contributor_b, &1_000_000);

    let expiry = later_ts(&env, 1_000);
    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &100,
        &expiry,
        &ClaimCondition::None,
        &sender,
        &message_hash(&env),
    );

    client.contribute(&contributor_a, &gift_id, &250);
    client.contribute(&contributor_b, &gift_id, &400);

    let sender_balance_before = token.client.balance(&sender);
    let a_balance_before = token.client.balance(&contributor_a);
    let b_balance_before = token.client.balance(&contributor_b);

    env.ledger().set_timestamp(expiry + 1);

    // Any contributor (not the sender) can trigger the refund sweep.
    client.refund(&gift_id, &contributor_b);

    assert_eq!(token.client.balance(&sender), sender_balance_before + 100);
    assert_eq!(token.client.balance(&contributor_a), a_balance_before + 250);
    assert_eq!(token.client.balance(&contributor_b), b_balance_before + 400);

    let gift = client.get_gift(&gift_id);
    assert_eq!(gift.status, crate::types::GiftStatus::Refunded);
}

#[test]
fn test_expired_gift_claim_fails() {
    let (env, client, token, sender, receiver) = setup();

    let expiry = later_ts(&env, 1_000);
    let gift_id = client.create_gift(
        &sender,
        &receiver,
        &token.address,
        &150,
        &expiry,
        &ClaimCondition::None,
        &sender,
        &message_hash(&env),
    );

    env.ledger().set_timestamp(expiry + 1);

    let result = client.try_claim(&gift_id, &receiver, &None);
    assert!(result.is_err());
}
