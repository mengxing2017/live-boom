use play_core::rules::{QUEUE_CAPACITY, can_accept};

#[test]
fn queue_capacity_is_enforced() {
    assert!(can_accept(0).is_ok());
    assert!(can_accept(QUEUE_CAPACITY - 1).is_ok());
    assert!(can_accept(QUEUE_CAPACITY).is_err());
}
