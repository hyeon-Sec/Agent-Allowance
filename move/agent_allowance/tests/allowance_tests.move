#[test_only]
module agent_allowance::allowance_tests;

use agent_allowance::allowance::{Self, Allowance, OwnerCap};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const AGENT: address = @0xB;
const SHOP: address = @0xC;
const HACKER: address = @0xD;
const DAY_MS: u64 = 86_400_000;

/// Allowance of 10_000 with per-tx 1_000, daily 2_500, SHOP allowlisted.
fun setup(): (Scenario, Clock) {
    let mut sc = ts::begin(OWNER);
    let clock = clock::create_for_testing(sc.ctx());
    let funds = coin::mint_for_testing<SUI>(10_000, sc.ctx());
    let cap = allowance::create(AGENT, 1_000, 2_500, vector[SHOP], funds, &clock, sc.ctx());
    transfer::public_transfer(cap, OWNER);
    sc.next_tx(AGENT);
    (sc, clock)
}

/// Runs one `spend` as AGENT in its own transaction.
fun spend(sc: &mut Scenario, clock: &Clock, recipient: address, amount: u64): bool {
    sc.next_tx(AGENT);
    let mut a = sc.take_shared<Allowance>();
    let ok = a.spend(recipient, amount, b"memo".to_string(), b"blob".to_string(), clock, sc.ctx());
    ts::return_shared(a);
    ok
}

fun finish(sc: Scenario, clock: Clock) {
    clock.destroy_for_testing();
    sc.end();
}

#[test]
fun approved_spend_pays_recipient() {
    let (mut sc, clock) = setup();
    assert!(spend(&mut sc, &clock, SHOP, 700));

    let effects = sc.next_tx(OWNER);
    assert!(effects.num_user_events() == 1);
    let paid = sc.take_from_address<Coin<SUI>>(SHOP);
    assert!(paid.value() == 700);
    ts::return_to_address(SHOP, paid);

    let a = sc.take_shared<Allowance>();
    assert!(a.balance_value() == 9_300);
    assert!(a.spent_in_window() == 700);
    ts::return_shared(a);
    finish(sc, clock);
}

#[test]
fun unknown_recipient_is_blocked() {
    let (mut sc, clock) = setup();
    assert!(!spend(&mut sc, &clock, HACKER, 100));

    let effects = sc.next_tx(OWNER);
    assert!(effects.num_user_events() == 1);
    let a = sc.take_shared<Allowance>();
    assert!(a.balance_value() == 10_000);
    assert!(a.spent_in_window() == 0);
    ts::return_shared(a);
    finish(sc, clock);
}

#[test]
fun over_per_tx_limit_is_blocked() {
    let (mut sc, clock) = setup();
    assert!(!spend(&mut sc, &clock, SHOP, 1_001));
    finish(sc, clock);
}

#[test]
fun daily_limit_blocks_then_resets_next_day() {
    let (mut sc, mut clock) = setup();
    assert!(spend(&mut sc, &clock, SHOP, 1_000));
    assert!(spend(&mut sc, &clock, SHOP, 1_000));
    assert!(!spend(&mut sc, &clock, SHOP, 1_000));
    assert!(spend(&mut sc, &clock, SHOP, 500));

    clock.increment_for_testing(DAY_MS);
    assert!(spend(&mut sc, &clock, SHOP, 1_000));
    finish(sc, clock);
}

#[test]
fun lowered_daily_limit_blocks_without_underflow() {
    let (mut sc, clock) = setup();
    assert!(spend(&mut sc, &clock, SHOP, 1_000));

    sc.next_tx(OWNER);
    let cap = sc.take_from_sender<OwnerCap>();
    let mut a = sc.take_shared<Allowance>();
    a.set_limits(&cap, 1_000, 500);
    ts::return_shared(a);
    sc.return_to_sender(cap);

    sc.next_tx(AGENT);
    assert!(!spend(&mut sc, &clock, SHOP, 100));
    finish(sc, clock);
}

#[test]
fun paused_allowance_blocks_spend() {
    let (mut sc, clock) = setup();
    sc.next_tx(OWNER);
    let cap = sc.take_from_sender<OwnerCap>();
    let mut a = sc.take_shared<Allowance>();
    a.set_paused(&cap, true);
    ts::return_shared(a);
    sc.return_to_sender(cap);

    sc.next_tx(AGENT);
    assert!(!spend(&mut sc, &clock, SHOP, 100));
    finish(sc, clock);
}

#[test]
fun owner_can_withdraw() {
    let (mut sc, clock) = setup();
    sc.next_tx(OWNER);
    let cap = sc.take_from_sender<OwnerCap>();
    let mut a = sc.take_shared<Allowance>();
    let coin = a.withdraw(&cap, 4_000, sc.ctx());
    assert!(coin.value() == 4_000);
    assert!(a.balance_value() == 6_000);
    transfer::public_transfer(coin, OWNER);
    ts::return_shared(a);
    sc.return_to_sender(cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = allowance::ENotAgent)]
fun non_agent_cannot_spend() {
    let (mut sc, clock) = setup();
    sc.next_tx(HACKER);
    let mut a = sc.take_shared<Allowance>();
    a.spend(SHOP, 100, b"memo".to_string(), b"blob".to_string(), &clock, sc.ctx());
    ts::return_shared(a);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = allowance::EWrongCap)]
fun foreign_cap_is_rejected() {
    let (mut sc, clock) = setup();
    sc.next_tx(HACKER);
    let victim_id = ts::most_recent_id_shared<Allowance>().destroy_some();
    let funds = coin::mint_for_testing<SUI>(1, sc.ctx());
    let foreign = allowance::create(HACKER, 1, 1, vector[], funds, &clock, sc.ctx());

    sc.next_tx(HACKER);
    let mut a = sc.take_shared_by_id<Allowance>(victim_id);
    let stolen = a.withdraw(&foreign, 10_000, sc.ctx());
    transfer::public_transfer(stolen, HACKER);
    transfer::public_transfer(foreign, HACKER);
    ts::return_shared(a);
    finish(sc, clock);
}
