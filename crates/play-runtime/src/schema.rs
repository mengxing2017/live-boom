//! Deliberately restricted, fail-closed v1 schema dialect (documented in docs/plugin-development.md).
use play_contracts::{AppError, AppResult};
use serde_json::Value;
fn invalid(message: &str) -> AppError {
    AppError::new("VALIDATION_FAILED", message)
}
pub fn check_schema(s: &Value) -> AppResult<()> {
    let o = s.as_object().ok_or_else(|| invalid("schema 必须是对象"))?;
    let allowed = [
        "type",
        "title",
        "description",
        "properties",
        "required",
        "additionalProperties",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "enum",
        "default",
    ];
    if o.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(invalid("不支持的 schema 关键字"));
    }
    let kind = s["type"]
        .as_str()
        .ok_or_else(|| invalid("缺少 schema type"))?;
    if !["object", "string", "number", "integer", "boolean"].contains(&kind) {
        return Err(invalid("不支持的 schema type"));
    }
    if kind == "object" {
        if s["additionalProperties"] != false {
            return Err(invalid("对象必须拒绝额外字段"));
        }
        let props = s["properties"]
            .as_object()
            .ok_or_else(|| invalid("缺少 properties"))?;
        if props.len() > 32 {
            return Err(invalid("字段过多"));
        }
        for v in props.values() {
            check_schema(v)?;
        }
        if let Some(required) = s.get("required") {
            let required = required
                .as_array()
                .ok_or_else(|| invalid("required 格式错误"))?;
            for k in required {
                if !k.as_str().is_some_and(|k| props.contains_key(k)) {
                    return Err(invalid("required 字段不存在"));
                }
            }
        }
    }
    for key in ["minLength", "maxLength"] {
        if let Some(v) = s.get(key)
            && v.as_u64().is_none()
        {
            return Err(invalid("长度限制必须为非负整数"));
        }
    }
    for key in ["minimum", "maximum"] {
        if let Some(v) = s.get(key)
            && !v.is_number()
        {
            return Err(invalid("数值限制错误"));
        }
    }
    if let Some(v) = s.get("enum")
        && v.as_array().is_none_or(|a| a.is_empty() || a.len() > 100)
    {
        return Err(invalid("enum 格式错误"));
    }
    Ok(())
}
pub fn validate(s: &Value, v: &Value) -> AppResult<()> {
    check_schema(s)?;
    if serde_json::to_vec(v)
        .map_err(|_| invalid("JSON 错误"))?
        .len()
        > 65536
    {
        return Err(invalid("输入超过 64 KiB"));
    }
    if s.get("enum")
        .and_then(Value::as_array)
        .is_some_and(|a| !a.contains(v))
    {
        return Err(invalid("值不在枚举中"));
    }
    match s["type"].as_str().unwrap_or_default() {
        "object" => {
            let obj = v.as_object().ok_or_else(|| invalid("值必须是对象"))?;
            let props = s["properties"]
                .as_object()
                .ok_or_else(|| invalid("缺少 properties"))?;
            if obj.keys().any(|k| !props.contains_key(k)) {
                return Err(invalid("包含未声明字段"));
            }
            if let Some(a) = s["required"].as_array() {
                for key in a {
                    if !obj.contains_key(key.as_str().unwrap_or_default()) {
                        return Err(invalid("缺少必填字段"));
                    }
                }
            }
            for (k, v) in obj {
                validate(&props[k], v)?;
            }
        }
        "string" => {
            let value = v.as_str().ok_or_else(|| invalid("值必须是文本"))?;
            use unicode_segmentation::UnicodeSegmentation;
            let n = value.graphemes(true).count() as u64;
            if value.chars().any(char::is_control)
                || s["minLength"].as_u64().is_some_and(|x| n < x)
                || s["maxLength"].as_u64().is_some_and(|x| n > x)
            {
                return Err(invalid("文本长度或控制字符错误"));
            }
        }
        "number" | "integer" => {
            let n = v.as_f64().ok_or_else(|| invalid("值必须是数字"))?;
            if s["type"] == "integer" && !v.is_i64() && !v.is_u64() {
                return Err(invalid("值必须是整数"));
            }
            if s["minimum"].as_f64().is_some_and(|x| n < x)
                || s["maximum"].as_f64().is_some_and(|x| n > x)
            {
                return Err(invalid("数字超出范围"));
            }
        }
        "boolean" if !v.is_boolean() => return Err(invalid("值必须是布尔值")),
        _ => {}
    }
    Ok(())
}
