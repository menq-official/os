//! JSON that says one thing: a decoder that refuses an object naming the same key twice.
//!
//! `serde_json::from_slice::<Value>` keeps the LAST of two equal keys and says nothing. For a
//! document a security decision is read from, that means the bytes can state two contradictory
//! things — `"ok":false,"ok":true`, two root keys, two protocols — and whichever parser, log or
//! person reads the other occurrence sees a different document from the one that was acted on.
//! Audit L-23, L-28 and L-34 are that one defect in three parsers.
//!
//! [`from_slice`] is the one decoder for such a document. It refuses a duplicate key at ANY
//! depth, and anything after the value. It does not check a schema: a caller still asks for
//! exactly the fields it needs and refuses what it does not know.
//!
//! The Python side has had this since `brops_protocol.strict_loads`; this is its Rust half.

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};

/// Why a document was refused. Deliberately small: a caller maps either to its own refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StrictJsonError {
    /// Not JSON, or something follows the value.
    NotJson,
    /// An object names this key more than once.
    DuplicateKey(String),
}

const DUPLICATE_MARK: &str = "strict_json duplicate key: ";

/// Parse `bytes` as one JSON value in which no object repeats a key.
pub fn from_slice(bytes: &[u8]) -> Result<Value, StrictJsonError> {
    let mut de = serde_json::Deserializer::from_slice(bytes);
    let value = NoDuplicates.deserialize(&mut de).map_err(classify)?;
    de.end().map_err(|_| StrictJsonError::NotJson)?;
    Ok(value)
}

/// [`from_slice`] for text.
pub fn from_str(text: &str) -> Result<Value, StrictJsonError> {
    from_slice(text.as_bytes())
}

fn classify(error: serde_json::Error) -> StrictJsonError {
    let text = error.to_string();
    match text.find(DUPLICATE_MARK) {
        Some(at) => {
            // serde_json appends " at line L column C" to a custom message.
            let rest = &text[at + DUPLICATE_MARK.len()..];
            let key = rest.rsplit_once(" at line ").map(|(k, _)| k).unwrap_or(rest);
            StrictJsonError::DuplicateKey(key.to_string())
        }
        None => StrictJsonError::NotJson,
    }
}

struct NoDuplicates;

impl<'de> DeserializeSeed<'de> for NoDuplicates {
    type Value = Value;
    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        deserializer.deserialize_any(NoDuplicates)
    }
}

impl<'de> Visitor<'de> for NoDuplicates {
    type Value = Value;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value with no repeated object key")
    }

    fn visit_bool<E>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Value, E> {
        Ok(Value::Number(v.into()))
    }
    fn visit_u64<E>(self, v: u64) -> Result<Value, E> {
        Ok(Value::Number(v.into()))
    }
    fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
        Number::from_f64(v).map(Value::Number).ok_or_else(|| E::custom("a number JSON cannot hold"))
    }
    fn visit_str<E>(self, v: &str) -> Result<Value, E> {
        Ok(Value::String(v.to_owned()))
    }
    fn visit_string<E>(self, v: String) -> Result<Value, E> {
        Ok(Value::String(v))
    }
    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element_seed(NoDuplicates)? {
            items.push(item);
        }
        Ok(Value::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if object.contains_key(&key) {
                return Err(serde::de::Error::custom(format!("{DUPLICATE_MARK}{key}")));
            }
            let value = map.next_value_seed(NoDuplicates)?;
            object.insert(key, value);
        }
        Ok(Value::Object(object))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_document_without_duplicates_is_the_value_serde_json_gives() {
        for text in [
            r#"{"ok":true,"op":"issue","n":[1,2,{"a":null,"b":-3,"c":1.5}],"s":"ժ é"}"#,
            "[]", "{}", "null", "true", "0", "-7", "18446744073709551615", "\"x\"", " { \"a\" : 1 } ",
        ] {
            let plain: Value = serde_json::from_str(text).unwrap();
            assert_eq!(from_str(text), Ok(plain), "{text}");
        }
    }

    #[test]
    fn a_repeated_key_is_refused_whichever_occurrence_would_have_won() {
        // serde_json keeps the last; another parser keeps the first. Neither is asked.
        for text in [
            r#"{"ok":false,"ok":true}"#,
            r#"{"ok":true,"ok":false}"#,
            r#"{"ok":true,"other":1,"ok":true}"#,
        ] {
            assert_eq!(from_str(text), Err(StrictJsonError::DuplicateKey("ok".into())), "{text}");
            assert!(serde_json::from_str::<Value>(text).is_ok(), "the plain decoder takes it: {text}");
        }
    }

    #[test]
    fn a_repeated_key_is_refused_at_any_depth() {
        for (text, key) in [
            (r#"{"a":{"b":1,"b":2}}"#, "b"),
            (r#"[{"x":1},{"y":{"z":[{"k":1,"k":1}]}}]"#, "k"),
            (r#"{"receipt":{"sig":"a","sig":"b"},"ok":true}"#, "sig"),
        ] {
            assert_eq!(from_str(text), Err(StrictJsonError::DuplicateKey(key.into())), "{text}");
        }
        // The same key in two DIFFERENT objects is not a repeat.
        assert_eq!(from_str(r#"[{"k":1},{"k":2}]"#), Ok(json!([{"k":1},{"k":2}])));
        assert_eq!(from_str(r#"{"k":{"k":1}}"#), Ok(json!({"k":{"k":1}})));
    }

    #[test]
    fn keys_that_differ_only_in_their_escaping_are_the_same_key() {
        // "ok" and "ok" are one key once decoded; the bytes differ and the meaning does not.
        assert_eq!(
            from_str(r#"{"ok":false,"ok":true}"#),
            Err(StrictJsonError::DuplicateKey("ok".into()))
        );
    }

    #[test]
    fn a_key_with_a_space_or_the_marker_in_it_is_still_named_exactly() {
        assert_eq!(from_str(r#"{"a at line 1":1,"a at line 1":2}"#), Err(StrictJsonError::DuplicateKey("a at line 1".into())));
    }

    #[test]
    fn what_is_not_one_json_value_is_refused() {
        for text in ["", "{", r#"{"a":1} {"a":2}"#, r#"{"a":1}x"#, "nope", r#"{"a":}"#, "[1,]"] {
            assert_eq!(from_str(text), Err(StrictJsonError::NotJson), "{text:?}");
        }
        assert_eq!(from_slice(&[0xff, 0xfe]), Err(StrictJsonError::NotJson));
    }
}
