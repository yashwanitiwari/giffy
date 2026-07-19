use soroban_sdk::{contracttype, Address, BytesN, Map};

#[derive(Clone)]
#[contracttype]
pub struct GiftRecord {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub contributions: Map<Address, i128>,
    pub expires_at: u64,
    pub status: GiftStatus,
    pub condition: ClaimCondition,
    pub steps_completed: u32,
    pub step_unlocker: Address,
    pub message_hash: BytesN<32>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
#[contracttype]
pub enum GiftStatus {
    Open,
    Claimed,
    Refunded,
}

#[derive(Clone, PartialEq, Eq, Debug)]
#[contracttype]
pub enum ClaimCondition {
    None,
    AnswerHash(BytesN<32>),
    StepGate(u32),
}
