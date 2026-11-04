use crate::error::QueueFull;

pub const QUEUE_CAPACITY: usize = 100;

/// 容量检查：返回 Ok(()) 表示还可以接纳新任务。
pub fn can_accept(queue_len: usize) -> Result<(), QueueFull> {
    if queue_len >= QUEUE_CAPACITY {
        Err(QueueFull {
            capacity: QUEUE_CAPACITY,
        })
    } else {
        Ok(())
    }
}
