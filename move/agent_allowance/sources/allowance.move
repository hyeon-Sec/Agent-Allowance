/// Agent Allowance: an on-chain spending policy for AI agents.
///
/// The owner funds a shared `Allowance` and sets its limits. The agent's key can
/// only move funds through `spend`, so the policy holds even if the agent is
/// prompt-injected or its key leaks. Policy violations do not abort: they are
/// recorded as `SpendBlocked` events, giving the owner an audit trail of every
/// attempt the chain refused.
module agent_allowance::allowance;

use std::string::String;
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use sui::vec_set::{Self, VecSet};

const DAY_MS: u64 = 86_400_000;

// Reasons carried by `SpendBlocked`.
const REASON_PAUSED: u8 = 1;
const REASON_RECIPIENT_NOT_ALLOWED: u8 = 2;
const REASON_PER_TX_LIMIT: u8 = 3;
const REASON_DAILY_LIMIT: u8 = 4;
const REASON_INSUFFICIENT_BALANCE: u8 = 5;

#[error]
const ENotAgent: vector<u8> = b"Only the registered agent can spend from this allowance";
#[error]
const EWrongCap: vector<u8> = b"OwnerCap does not belong to this allowance";
#[error]
const EInsufficientBalance: vector<u8> = b"Not enough balance to withdraw";

public struct Allowance has key {
    id: UID,
    agent: address,
    balance: Balance<SUI>,
    per_tx_limit: u64,
    daily_limit: u64,
    window_start_ms: u64,
    spent_in_window: u64,
    total_spent: u64,
    allowed_recipients: VecSet<address>,
    paused: bool,
}

/// Held by the owner; required for every policy change and withdrawal.
public struct OwnerCap has key, store {
    id: UID,
    allowance_id: ID,
}

public struct AllowanceCreated has copy, drop {
    allowance_id: ID,
    owner: address,
    agent: address,
    per_tx_limit: u64,
    daily_limit: u64,
}

public struct SpendApproved has copy, drop {
    allowance_id: ID,
    recipient: address,
    amount: u64,
    memo: String,
    log_blob_id: String,
    spent_in_window: u64,
    timestamp_ms: u64,
}

public struct SpendBlocked has copy, drop {
    allowance_id: ID,
    recipient: address,
    amount: u64,
    reason: u8,
    memo: String,
    log_blob_id: String,
    timestamp_ms: u64,
}

public struct PolicyUpdated has copy, drop {
    allowance_id: ID,
}

// === Owner ===

public fun create(
    agent: address,
    per_tx_limit: u64,
    daily_limit: u64,
    allowed_recipients: vector<address>,
    funds: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
): OwnerCap {
    let mut recipients = vec_set::empty();
    allowed_recipients.do!(|r| if (!recipients.contains(&r)) recipients.insert(r));

    let allowance = Allowance {
        id: object::new(ctx),
        agent,
        balance: funds.into_balance(),
        per_tx_limit,
        daily_limit,
        window_start_ms: clock.timestamp_ms(),
        spent_in_window: 0,
        total_spent: 0,
        allowed_recipients: recipients,
        paused: false,
    };
    let allowance_id = object::id(&allowance);
    event::emit(AllowanceCreated {
        allowance_id,
        owner: ctx.sender(),
        agent,
        per_tx_limit,
        daily_limit,
    });
    transfer::share_object(allowance);
    OwnerCap { id: object::new(ctx), allowance_id }
}

/// `create` for callers that just want the cap sent to themselves.
entry fun create_and_keep(
    agent: address,
    per_tx_limit: u64,
    daily_limit: u64,
    allowed_recipients: vector<address>,
    funds: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let cap = create(agent, per_tx_limit, daily_limit, allowed_recipients, funds, clock, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

public fun deposit(self: &mut Allowance, funds: Coin<SUI>) {
    self.balance.join(funds.into_balance());
}

public fun withdraw(
    self: &mut Allowance,
    cap: &OwnerCap,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    self.assert_cap(cap);
    assert!(amount <= self.balance.value(), EInsufficientBalance);
    coin::take(&mut self.balance, amount, ctx)
}

public fun set_limits(self: &mut Allowance, cap: &OwnerCap, per_tx_limit: u64, daily_limit: u64) {
    self.assert_cap(cap);
    self.per_tx_limit = per_tx_limit;
    self.daily_limit = daily_limit;
    self.emit_policy_updated();
}

public fun add_recipient(self: &mut Allowance, cap: &OwnerCap, recipient: address) {
    self.assert_cap(cap);
    if (!self.allowed_recipients.contains(&recipient)) self.allowed_recipients.insert(recipient);
    self.emit_policy_updated();
}

public fun remove_recipient(self: &mut Allowance, cap: &OwnerCap, recipient: address) {
    self.assert_cap(cap);
    if (self.allowed_recipients.contains(&recipient)) self.allowed_recipients.remove(&recipient);
    self.emit_policy_updated();
}

public fun set_paused(self: &mut Allowance, cap: &OwnerCap, paused: bool) {
    self.assert_cap(cap);
    self.paused = paused;
    self.emit_policy_updated();
}

/// Rotate the agent key, e.g. after a suspected compromise.
public fun set_agent(self: &mut Allowance, cap: &OwnerCap, agent: address) {
    self.assert_cap(cap);
    self.agent = agent;
    self.emit_policy_updated();
}

// === Agent ===

/// Pays `recipient` if the policy allows it. Returns false and emits
/// `SpendBlocked` instead of aborting when the policy refuses.
public fun spend(
    self: &mut Allowance,
    recipient: address,
    amount: u64,
    memo: String,
    log_blob_id: String,
    clock: &Clock,
    ctx: &mut TxContext,
): bool {
    assert!(ctx.sender() == self.agent, ENotAgent);

    let now = clock.timestamp_ms();
    if (now >= self.window_start_ms + DAY_MS) {
        self.window_start_ms = now;
        self.spent_in_window = 0;
    };

    let allowance_id = self.id.to_inner();
    let reason = self.check(recipient, amount);
    if (reason != 0) {
        event::emit(SpendBlocked {
            allowance_id,
            recipient,
            amount,
            reason,
            memo,
            log_blob_id,
            timestamp_ms: now,
        });
        return false
    };

    self.spent_in_window = self.spent_in_window + amount;
    self.total_spent = self.total_spent + amount;
    transfer::public_transfer(coin::take(&mut self.balance, amount, ctx), recipient);
    event::emit(SpendApproved {
        allowance_id,
        recipient,
        amount,
        memo,
        log_blob_id,
        spent_in_window: self.spent_in_window,
        timestamp_ms: now,
    });
    true
}

// === Views ===

public fun agent(self: &Allowance): address { self.agent }

public fun balance_value(self: &Allowance): u64 { self.balance.value() }

public fun per_tx_limit(self: &Allowance): u64 { self.per_tx_limit }

public fun daily_limit(self: &Allowance): u64 { self.daily_limit }

public fun spent_in_window(self: &Allowance): u64 { self.spent_in_window }

public fun total_spent(self: &Allowance): u64 { self.total_spent }

public fun is_paused(self: &Allowance): bool { self.paused }

public fun is_allowed(self: &Allowance, recipient: address): bool {
    self.allowed_recipients.contains(&recipient)
}

// === Internal ===

/// Returns 0 when the spend is allowed, otherwise the blocking reason.
fun check(self: &Allowance, recipient: address, amount: u64): u8 {
    if (self.paused) return REASON_PAUSED;
    if (!self.allowed_recipients.contains(&recipient)) return REASON_RECIPIENT_NOT_ALLOWED;
    if (amount > self.per_tx_limit) return REASON_PER_TX_LIMIT;
    // Written to avoid overflow and underflow when the owner lowers the limit mid-window.
    if (amount > self.daily_limit || self.spent_in_window > self.daily_limit - amount) {
        return REASON_DAILY_LIMIT
    };
    if (amount > self.balance.value()) return REASON_INSUFFICIENT_BALANCE;
    0
}

fun assert_cap(self: &Allowance, cap: &OwnerCap) {
    assert!(cap.allowance_id == self.id.to_inner(), EWrongCap);
}

fun emit_policy_updated(self: &Allowance) {
    event::emit(PolicyUpdated { allowance_id: self.id.to_inner() });
}
