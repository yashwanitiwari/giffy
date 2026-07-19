use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GiftEscrowError {
    GiftNotFound = 1,
    GiftNotOpen = 2,
    GiftExpired = 3,
    GiftNotYetExpired = 4,
    NotReceiver = 5,
    WrongAnswer = 6,
    StepsNotComplete = 7,
    NotAuthorizedUnlocker = 8,
    AllStepsAlreadyComplete = 9,
    InvalidContributionAmount = 10,
    InvalidExpiry = 11,
    NotStepGated = 12,
    NotSenderOrContributor = 13,
}
