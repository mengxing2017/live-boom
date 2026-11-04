use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueFull {
    pub capacity: usize,
}

impl fmt::Display for QueueFull {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "队列已满，最多容纳 {} 条", self.capacity)
    }
}
