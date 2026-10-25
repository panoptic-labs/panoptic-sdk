use std::{env, thread};
use tiny_keccak::{Hasher, Keccak};

fn hash(bytes: &[u8]) -> [u8; 32] {
    let mut k = Keccak::v256();
    k.update(bytes);
    let mut out = [0; 32];
    k.finalize(&mut out);
    out
}

fn decode(s: &str) -> Vec<u8> {
    assert_eq!(s.len() % 2, 0);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let initializer = decode(&args[1]);
    let factory = decode(&args[2]);
    let code = decode(&args[3]);
    let start: u64 = args[4].parse().expect("start");
    let count: u64 = args[5].parse().expect("count");
    let threads: u64 = args[6].parse().expect("threads");
    let end = start.checked_add(count).expect("range exceeds u64");
    assert!(threads > 0 && threads <= 256);
    let prefixes: Vec<Vec<u8>> = args[7]
        .split(',')
        .map(|p| {
            p.bytes()
                .map(|b| (b as char).to_digit(16).expect("prefix") as u8)
                .collect()
        })
        .collect();
    let mut salt_input = [0u8; 64];
    salt_input[..32].copy_from_slice(&initializer);
    let mut address_input = [0u8; 85];
    address_input[0] = 255;
    address_input[1..21].copy_from_slice(&factory);
    address_input[53..].copy_from_slice(&code);
    thread::scope(|scope| {
        for worker in 0..threads {
            let prefixes = &prefixes;
            scope.spawn(move || {
                let mut salt_input = salt_input;
                let mut address_input = address_input;
                let mut found = vec![false; prefixes.len()];
                let mut nonce = start.checked_add(worker).expect("worker range");
                while nonce < end {
                    salt_input[56..].copy_from_slice(&nonce.to_be_bytes());
                    address_input[21..53].copy_from_slice(&hash(&salt_input));
                    let address = hash(&address_input);
                    for (index, prefix) in prefixes.iter().enumerate() {
                        if !found[index]
                            && prefix.iter().enumerate().all(|(i, n)| {
                                let b = address[12 + i / 2];
                                *n == if i % 2 == 0 { b >> 4 } else { b & 15 }
                            })
                        {
                            found[index] = true;
                            let hex: String =
                                address[12..].iter().map(|b| format!("{b:02x}")).collect();
                            println!("{index} {nonce} 0x{hex}");
                        }
                    }
                    match nonce.checked_add(threads) {
                        Some(next) => nonce = next,
                        None => break,
                    }
                }
            });
        }
    });
}
