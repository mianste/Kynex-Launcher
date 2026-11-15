use crate::Result;

const INVALID: &str = "投影文件中的 NBT 数据无效";

pub(super) fn check(bytes: &[u8]) -> Result<()> {
    let mut reader = Reader {
        remaining: bytes,
        entries: 4_000_000,
    };
    if reader.tag()? != 10 {
        return Err(INVALID.into());
    }
    reader.string()?;
    reader.payload(10, 0)
}

struct Reader<'a> {
    remaining: &'a [u8],
    entries: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let (head, tail) = self.remaining.split_at_checked(count).ok_or(INVALID)?;
        self.remaining = tail;
        Ok(head)
    }

    fn tag(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn string(&mut self) -> Result<()> {
        let width = u16::from_be_bytes(self.take(2)?.try_into().map_err(|_| INVALID)?);
        self.take(usize::from(width))?;
        Ok(())
    }

    fn length(&mut self) -> Result<usize> {
        let length = i32::from_be_bytes(self.take(4)?.try_into().map_err(|_| INVALID)?);
        usize::try_from(length).map_err(|_| INVALID.into())
    }

    fn payload(&mut self, tag: u8, depth: usize) -> Result<()> {
        if depth > 64 || self.entries == 0 {
            return Err("投影文件包含过多层级或数据项，无法预览".into());
        }
        self.entries -= 1;
        match tag {
            1..=6 => {
                self.take([1, 2, 4, 8, 4, 8][usize::from(tag) - 1])?;
            }
            7 | 11 | 12 => {
                let width = match tag {
                    7 => 1,
                    11 => 4,
                    _ => 8,
                };
                let count = self.length()?.checked_mul(width).ok_or(INVALID)?;
                self.take(count)?;
            }
            8 => self.string()?,
            9 => {
                let item = self.tag()?;
                let count = self.length()?;
                if (1..=6).contains(&item) {
                    self.entries = self.entries.checked_sub(count).ok_or(INVALID)?;
                    let width = [1, 2, 4, 8, 4, 8][usize::from(item) - 1];
                    self.take(count.checked_mul(width).ok_or(INVALID)?)?;
                } else {
                    for _ in 0..count {
                        self.payload(item, depth + 1)?;
                    }
                }
            }
            10 => loop {
                let item = self.tag()?;
                if item == 0 {
                    break;
                }
                self.string()?;
                self.payload(item, depth + 1)?;
            },
            _ => return Err(INVALID.into()),
        }
        Ok(())
    }
}
