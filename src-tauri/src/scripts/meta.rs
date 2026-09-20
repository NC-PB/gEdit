//! The script metadata header (plan AD-13, `docs/planning/scripting.md`). Owner: **WP4.5**.
//!
//! A script declares itself in a comment block at the top of the file:
//!
//! ```python
//! # /// gedit
//! # name = "Scale feed rates"
//! # description = "Multiply F values by a percentage."
//! # profiles = ["fanuc-gcode"]          # omit = every profile
//! # input = "selection-or-document"
//! # output = "replace"
//! # timeout = 60
//! # envelope = true
//! #
//! # [[params]]
//! # id = "percent"
//! # label = "Percentage"
//! # type = "number"
//! # default = 100
//! # ///
//! ```
//!
//! The rules, and what each one costs a script that breaks it:
//!
//! - The first non-empty line after an optional shebang and an optional coding line has
//!   to be `# /// gedit`; the block ends at the first `# ///`. Anything else means the
//!   script has no header and runs in v1 (panel) mode — [`Header::default`].
//! - The body is the block's lines with the leading `# ` removed, parsed as TOML.
//! - An **unknown field** is a warning: it lands in [`ScriptMeta::warnings`] and the
//!   script still runs with everything else it declared.
//! - An **invalid value** (bad TOML, a bad enum, a timeout out of range, a parameter
//!   without a label) is a [`Header::error`]: the script is still listed and still runs,
//!   but in panel mode, and the UI shows the message. Panel mode is the safe fallback —
//!   a half-understood header must never be read as `output = "replace"`, because that
//!   would let a misdeclared script rewrite the document.
//! - `documents` other than `active` is a warning and is treated as `active` in P1.
//!
//! Line numbers in an error count in the **file**, not in the extracted body, so that
//! "line 7" means what the editor's gutter says.
//!
//! `ScriptMeta` is what `scripts_list` hands the webview; it mirrors `ScriptMeta` in
//! `src/lib/platform/commands.ts` (§7.6) field for field, and `ParamSpec` is shaped like
//! `FieldSpec` (`src/lib/core/forms/types.ts`) so the webview can hand it straight to
//! `modals.form()`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::settings::{MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS};

/// The line that opens the block.
pub const HEADER_START: &str = "# /// gedit";
/// The line that closes it.
pub const HEADER_END: &str = "# ///";

/// The header fields a script may declare. Anything else is a warning.
const HEADER_FIELDS: &[&str] = &[
    "name",
    "description",
    "profiles",
    "input",
    "output",
    "timeout",
    "envelope",
    "documents",
    "params",
];

/// The fields of one `[[params]]` table. Anything else is a warning.
const PARAM_FIELDS: &[&str] = &[
    "id", "type", "label", "help", "default", "required", "min", "max", "decimals", "choices",
];

/// The `type` values a parameter may use; the same set as `FieldType` in
/// `src/lib/core/forms/types.ts`.
const PARAM_TYPES: &[&str] = &[
    "number",
    "integer",
    "text",
    "bool",
    "choice",
    "file",
    "folder",
    "address-list",
];

/// The most decimal places a `number` parameter may ask for. Beyond this the value no
/// longer survives a round trip through a double, so a script could silently widen a
/// coordinate.
const MAX_DECIMALS: u32 = 10;

/// Where a script wants its stdin from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ScriptInput {
    /// The selection when there is one, else the whole document. The default.
    #[default]
    SelectionOrDocument,
    Selection,
    Document,
    /// Nothing on stdin; the script only reads its context and parameters.
    None,
}

/// What the app does with stdout (`docs/planning/scripting.md` "Output modes").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ScriptOutput {
    /// v1 behaviour: raw stdout and parsed JSON in the output panel. The default.
    #[default]
    Panel,
    /// New text for the input range, applied as one undo step.
    Replace,
    /// Text for a new untitled document with the same profile.
    NewDocument,
    /// A JSON report for the results panel.
    Report,
}

/// Which documents the context carries. P1 only supports `active` (plan §10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ScriptDocuments {
    #[default]
    Active,
    AllOpen,
    Pick,
}

/// One declared parameter. Shaped like `FieldSpec` (plan §7.5) so that the webview can
/// hand it straight to `modals.form()`; `label` and `help` are display text, not i18n
/// keys (AD-14).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParamSpec {
    pub id: String,
    /// `number` | `integer` | `text` | `bool` | `choice` | `file` | `folder` | `address-list`.
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decimals: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<ChoiceSpec>>,
}

/// One option of a `choice` or `address-list` parameter. `label` is display text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChoiceSpec {
    pub label: String,
    pub value: Value,
}

/// A script's header, as the webview sees it (§7.6 `ScriptMeta`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptMeta {
    /// The menu label. Data, never translated (AD-14).
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// The profiles the script is offered for; `null` means every profile.
    #[serde(default)]
    pub profiles: Option<Vec<String>>,
    #[serde(default)]
    pub input: ScriptInput,
    #[serde(default)]
    pub output: ScriptOutput,
    /// Seconds. `null` means `scripts.timeoutSeconds` from the settings.
    #[serde(default)]
    pub timeout: Option<u64>,
    /// stdout is the JSON envelope `{ text, message, findings }` rather than plain text.
    #[serde(default)]
    pub envelope: bool,
    #[serde(default)]
    pub documents: ScriptDocuments,
    #[serde(default)]
    pub params: Vec<ParamSpec>,
    /// Unknown fields and downgraded values. English detail text (AD-14).
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// What reading a script's first lines produced.
///
/// `meta: None, error: None` is the normal "no header, run in v1 mode" answer;
/// `meta: None, error: Some(_)` is a header that is there but unusable.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Header {
    pub meta: Option<ScriptMeta>,
    pub error: Option<String>,
}

impl Header {
    /// A header that is there but cannot be used.
    fn failed(error: String) -> Self {
        Self {
            meta: None,
            error: Some(error),
        }
    }
}

/// The `# /// gedit` block, lifted out of a script's source.
#[derive(Debug, Clone, PartialEq)]
struct Block {
    /// The block's lines with their `# ` prefix removed — one body line per file line,
    /// which is what lets [`at_line`] report file line numbers.
    body: String,
    /// The 1-based file line the `# /// gedit` marker sits on.
    start_line: usize,
}

/// Reads the `# /// gedit` block out of a script's source.
///
/// Never panics and never reads the file system: `source` is the first
/// [`super::discovery::MAX_HEADER_BYTES`] of the script, decoded lossily.
pub fn parse_header(source: &str) -> Header {
    match extract_block(source) {
        Ok(None) => Header::default(),
        Ok(Some(block)) => match parse_block(&block) {
            Ok(meta) => Header {
                meta: Some(meta),
                error: None,
            },
            Err(error) => Header::failed(error),
        },
        Err(error) => Header::failed(error),
    }
}

/// `Ok(None)` = the script has no header. `Err` = the block starts but never closes,
/// which is a mistake worth reporting rather than treating as "no header".
fn extract_block(source: &str) -> Result<Option<Block>, String> {
    let unclosed = || format!("the `{HEADER_START}` block is not closed with `{HEADER_END}`");
    let mut lines = source.lines().enumerate();
    let mut start_line = None;
    for (index, raw) in lines.by_ref() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        // A shebang only counts on the first line, and a PEP 263 coding line only on
        // the first two — the same places Python itself looks for them.
        if index == 0 && line.starts_with("#!") {
            continue;
        }
        if index <= 1 && is_coding_line(line) {
            continue;
        }
        if line == HEADER_START {
            start_line = Some(index + 1);
        }
        break;
    }
    let Some(start_line) = start_line else {
        return Ok(None);
    };

    let mut body = String::new();
    for (_, raw) in lines {
        if raw.trim() == HEADER_END {
            return Ok(Some(Block { body, start_line }));
        }
        // Anything that is not a comment means the block was never closed: the script's
        // code has started, and TOML would make nonsense of it.
        let Some(rest) = strip_comment(raw) else {
            return Err(unclosed());
        };
        body.push_str(rest);
        body.push('\n');
    }
    Err(unclosed())
}

/// A PEP 263 `# -*- coding: utf-8 -*-` or `# coding=latin-1` line.
fn is_coding_line(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('#') else {
        return false;
    };
    rest.match_indices("coding")
        .any(|(at, _)| matches!(rest[at + "coding".len()..].chars().next(), Some(':' | '=')))
}

/// `# name = "x"` → `name = "x"`. One space after the `#` is the comment marker, any
/// further space is TOML indentation and is kept.
fn strip_comment(line: &str) -> Option<&str> {
    let rest = line.trim_start().strip_prefix('#')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

fn parse_block(block: &Block) -> Result<ScriptMeta, String> {
    // Parsed twice on purpose: once loosely, to see which keys the author actually
    // wrote (serde cannot report an unknown field *and* keep going), and once into the
    // typed struct. Both parses carry spans, so either can point at a line.
    let table: toml::Table = toml::from_str(&block.body).map_err(|err| at_line(block, &err))?;
    let mut warnings = unknown_fields(&table);
    let mut meta: ScriptMeta = toml::from_str(&block.body).map_err(|err| at_line(block, &err))?;
    validate(&mut meta, &mut warnings)?;
    meta.warnings = warnings;
    Ok(meta)
}

/// A TOML error as one line, with the line number translated into the file's own
/// numbering. `toml`'s own `Display` renders a three-line excerpt with a caret, which
/// reads badly in a tooltip.
fn at_line(block: &Block, err: &toml::de::Error) -> String {
    match err.span() {
        Some(span) => {
            // `get`, not a slice: a span that is out of range or not on a character
            // boundary must give a vaguer message, never panic inside a command.
            let before = block.body.get(..span.start).unwrap_or(&block.body);
            let line = block.start_line + before.matches('\n').count() + 1;
            format!("line {line}: {}", err.message())
        }
        None => err.message().to_string(),
    }
}

/// Every key the author wrote that this build does not know about, as warnings.
fn unknown_fields(table: &toml::Table) -> Vec<String> {
    let mut warnings: Vec<String> = table
        .keys()
        .filter(|key| !HEADER_FIELDS.contains(&key.as_str()))
        .map(|key| format!("`{key}` is not a header field and is ignored"))
        .collect();

    let params = table.get("params").and_then(toml::Value::as_array);
    for (index, param) in params.into_iter().flatten().enumerate() {
        let Some(param) = param.as_table() else {
            continue;
        };
        // The author's own name for this parameter reads better than "params[2]", but
        // the index is the only thing a parameter without a usable `id` has.
        let named = param
            .get("id")
            .and_then(toml::Value::as_str)
            .map(|id| format!("parameter `{id}`"))
            .unwrap_or_else(|| format!("parameter {}", index + 1));
        warnings.extend(
            param
                .keys()
                .filter(|key| !PARAM_FIELDS.contains(&key.as_str()))
                .map(|key| format!("{named}: `{key}` is not a parameter field and is ignored")),
        );
    }
    warnings
}

/// The checks TOML's type system cannot make. Anything returned here makes the whole
/// header unusable, so it is only for values that would make the script misbehave.
fn validate(meta: &mut ScriptMeta, warnings: &mut Vec<String>) -> Result<(), String> {
    if meta.name.trim().is_empty() {
        return Err("`name` must not be empty".to_string());
    }
    if meta.documents != ScriptDocuments::Active {
        warnings.push(
            "`documents` other than `active` is not supported yet; the active document is used"
                .to_string(),
        );
        meta.documents = ScriptDocuments::Active;
    }
    if let Some(timeout) = meta.timeout {
        if !(MIN_TIMEOUT_SECONDS..=MAX_TIMEOUT_SECONDS).contains(&timeout) {
            return Err(format!(
                "`timeout` must be between {MIN_TIMEOUT_SECONDS} and {MAX_TIMEOUT_SECONDS} seconds"
            ));
        }
    }
    match meta.profiles.as_deref() {
        Some([]) => {
            warnings
                .push("`profiles` is empty; the script is offered for every profile".to_string());
            meta.profiles = None;
        }
        Some(profiles) if profiles.iter().any(|id| id.trim().is_empty()) => {
            return Err("`profiles` must not contain an empty profile id".to_string());
        }
        _ => {}
    }

    let mut seen: Vec<&str> = Vec::with_capacity(meta.params.len());
    for param in &meta.params {
        validate_param(param)?;
        if seen.contains(&param.id.as_str()) {
            return Err(format!("parameter `{}` is declared twice", param.id));
        }
        seen.push(&param.id);
    }
    Ok(())
}

fn validate_param(param: &ParamSpec) -> Result<(), String> {
    let id = &param.id;
    // The id is a key in the values record, in the remembered `lastParams` JSON and in
    // the script's own context file, so it has to survive all three unchanged.
    let usable_id = !id.is_empty()
        && !id.starts_with(|c: char| c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !usable_id {
        return Err(format!(
            "parameter `{id}`: `id` must be letters, digits, `_` or `-`, and must not start with a digit"
        ));
    }
    if param.label.trim().is_empty() {
        return Err(format!("parameter `{id}`: `label` must not be empty"));
    }
    if !PARAM_TYPES.contains(&param.kind.as_str()) {
        return Err(format!(
            "parameter `{id}`: `type` must be one of {}",
            PARAM_TYPES.join(", ")
        ));
    }
    if let Some(decimals) = param.decimals {
        if decimals > MAX_DECIMALS {
            return Err(format!(
                "parameter `{id}`: `decimals` must be at most {MAX_DECIMALS}"
            ));
        }
    }
    if let (Some(min), Some(max)) = (param.min, param.max) {
        if min > max {
            return Err(format!("parameter `{id}`: `min` is greater than `max`"));
        }
    }
    let choices = param.choices.as_deref().unwrap_or_default();
    if param.kind == "choice" && choices.is_empty() {
        return Err(format!(
            "parameter `{id}`: a `choice` parameter needs a non-empty `choices` list"
        ));
    }
    for choice in choices {
        if choice.label.trim().is_empty() {
            return Err(format!("parameter `{id}`: a choice needs a `label`"));
        }
        if !is_scalar(&choice.value) {
            return Err(format!(
                "parameter `{id}`: a choice `value` must be text, a number or a boolean"
            ));
        }
    }
    if let Some(default) = &param.default {
        validate_default(param, default, choices)?;
    }
    Ok(())
}

/// A default of the wrong type would be shown in the form, remembered, and handed to
/// the script as-is, so it is worth refusing the header over.
fn validate_default(
    param: &ParamSpec,
    default: &Value,
    choices: &[ChoiceSpec],
) -> Result<(), String> {
    let id = &param.id;
    let wrong = |expected: &str| Err(format!("parameter `{id}`: `default` must be {expected}"));
    match param.kind.as_str() {
        "number" => {
            if !default.is_number() {
                return wrong("a number");
            }
        }
        "integer" => {
            if !default.is_i64() && !default.is_u64() {
                return wrong("a whole number");
            }
        }
        "bool" => {
            if !default.is_boolean() {
                return wrong("true or false");
            }
        }
        "text" | "file" | "folder" => {
            if !default.is_string() {
                return wrong("text");
            }
        }
        "choice" => {
            if !choices.iter().any(|choice| &choice.value == default) {
                return wrong("one of the declared `choices` values");
            }
        }
        "address-list" => {
            let ok = default
                .as_array()
                .is_some_and(|items| items.iter().all(Value::is_string));
            if !ok {
                return wrong("a list of address letters");
            }
        }
        _ => {}
    }
    Ok(())
}

fn is_scalar(value: &Value) -> bool {
    value.is_string() || value.is_number() || value.is_boolean()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(source: &str) -> ScriptMeta {
        let header = parse_header(source);
        assert_eq!(header.error, None, "{source}");
        header.meta.expect("no header")
    }

    fn error(source: &str) -> String {
        let header = parse_header(source);
        assert_eq!(header.meta, None, "{source}");
        header.error.expect("expected an error")
    }

    const FULL: &str = r#"#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# /// gedit
# name = "Scale feed rates"
# description = "Multiply F values by a percentage."
# profiles = ["fanuc-gcode", "heidenhain-klartext"]
# input = "selection-or-document"
# output = "replace"
# timeout = 30
# envelope = true
# documents = "active"
#
# [[params]]
# id = "percent"
# label = "Percentage"
# type = "number"
# default = 100
# min = 1
# max = 500
# decimals = 2
#
# [[params]]
# id = "mode"
# label = "Mode"
# type = "choice"
# default = "all"
# choices = [{ label = "All", value = "all" }, { label = "Rapids", value = "rapid" }]
# ///
import sys
print(sys.stdin.read())
"#;

    #[test]
    fn reads_a_full_header_past_the_shebang_and_the_coding_line() {
        let meta = meta(FULL);
        assert_eq!(meta.name, "Scale feed rates");
        assert_eq!(meta.description, "Multiply F values by a percentage.");
        assert_eq!(
            meta.profiles.as_deref(),
            Some(&["fanuc-gcode".to_string(), "heidenhain-klartext".to_string()][..])
        );
        assert_eq!(meta.input, ScriptInput::SelectionOrDocument);
        assert_eq!(meta.output, ScriptOutput::Replace);
        assert_eq!(meta.timeout, Some(30));
        assert!(meta.envelope);
        assert_eq!(meta.documents, ScriptDocuments::Active);
        assert_eq!(meta.warnings, Vec::<String>::new());

        assert_eq!(meta.params.len(), 2);
        let percent = &meta.params[0];
        assert_eq!(percent.id, "percent");
        assert_eq!(percent.kind, "number");
        assert_eq!(percent.label, "Percentage");
        assert_eq!(percent.default, Some(Value::from(100)));
        assert_eq!(percent.min, Some(1.0));
        assert_eq!(percent.max, Some(500.0));
        assert_eq!(percent.decimals, Some(2));
        let mode = &meta.params[1];
        assert_eq!(mode.kind, "choice");
        assert_eq!(mode.choices.as_ref().map(Vec::len), Some(2));
        assert_eq!(mode.choices.as_ref().unwrap()[0].label, "All");
    }

    /// The defaults are what a one-line header means, and they are the safe ones:
    /// stdin from the selection, output to the panel, no timeout of its own.
    #[test]
    fn a_minimal_header_gets_the_documented_defaults() {
        let meta = meta("# /// gedit\n# name = \"Tiny\"\n# ///\n");
        assert_eq!(meta.name, "Tiny");
        assert_eq!(meta.description, "");
        assert_eq!(meta.profiles, None);
        assert_eq!(meta.input, ScriptInput::SelectionOrDocument);
        assert_eq!(meta.output, ScriptOutput::Panel);
        assert_eq!(meta.timeout, None);
        assert!(!meta.envelope);
        assert_eq!(meta.documents, ScriptDocuments::Active);
        assert!(meta.params.is_empty());
    }

    /// No header at all is not an error: the script runs in v1 (panel) mode.
    #[test]
    fn a_script_without_a_header_has_neither_meta_nor_error() {
        for source in [
            "",
            "\n\n\n",
            "import sys\n# /// gedit\n# name = \"Too late\"\n# ///\n",
            "#!/usr/bin/env python3\nimport sys\n",
            "# just a comment\n# /// gedit\n# name = \"Too late\"\n# ///\n",
            // A coding line is only recognized on the first two lines, as in Python.
            "#\n#\n# coding: utf-8\n# /// gedit\n# name = \"x\"\n# ///\n",
            "# /// gedit is not the marker\n",
        ] {
            assert_eq!(parse_header(source), Header::default(), "{source:?}");
        }
    }

    #[test]
    fn a_block_that_never_closes_is_an_error() {
        for source in [
            "# /// gedit\n# name = \"x\"\n",
            "# /// gedit\n# name = \"x\"\nimport sys\n# ///\n",
        ] {
            assert!(error(source).contains("not closed"), "{source:?}");
        }
    }

    #[test]
    fn bad_toml_is_an_error_with_the_file_s_own_line_number() {
        // The `# /// gedit` marker is on file line 2, so `name = ` is on line 3.
        let message = error("#!/usr/bin/env python3\n# /// gedit\n# name = \n# ///\n");
        assert!(message.starts_with("line 3: "), "{message}");
    }

    #[test]
    fn an_invalid_enum_is_an_error() {
        for (field, value) in [
            ("input", "everything"),
            ("output", "overwrite"),
            ("documents", "some"),
        ] {
            let source = format!("# /// gedit\n# name = \"x\"\n# {field} = \"{value}\"\n# ///\n");
            let message = error(&source);
            assert!(message.contains("unknown variant"), "{message}");
            assert!(message.starts_with("line 3: "), "{message}");
        }
    }

    #[test]
    fn an_unknown_field_is_only_a_warning() {
        let meta = meta(
            "# /// gedit\n# name = \"x\"\n# output = \"replace\"\n# colour = \"red\"\n# ///\n",
        );
        // The script keeps every field it did declare.
        assert_eq!(meta.output, ScriptOutput::Replace);
        assert_eq!(
            meta.warnings,
            ["`colour` is not a header field and is ignored"]
        );
    }

    #[test]
    fn an_unknown_parameter_field_is_a_warning_naming_the_parameter() {
        let meta = meta(concat!(
            "# /// gedit\n# name = \"x\"\n",
            "# [[params]]\n# id = \"p\"\n# label = \"P\"\n# type = \"text\"\n# units = \"mm\"\n",
            "# [[params]]\n# id = \"q\"\n# label = \"Q\"\n# type = \"text\"\n# units = \"mm\"\n",
            "# ///\n"
        ));
        assert_eq!(
            meta.warnings,
            [
                "parameter `p`: `units` is not a parameter field and is ignored",
                "parameter `q`: `units` is not a parameter field and is ignored"
            ]
        );
    }

    /// P1 only carries the active document, and a script that asked for more has to be
    /// told so rather than silently getting a context that is missing what it needs.
    #[test]
    fn documents_other_than_active_is_a_warning_and_is_downgraded() {
        let meta = meta("# /// gedit\n# name = \"x\"\n# documents = \"all-open\"\n# ///\n");
        assert_eq!(meta.documents, ScriptDocuments::Active);
        assert_eq!(meta.warnings.len(), 1);
        assert!(meta.warnings[0].contains("active document is used"));
    }

    #[test]
    fn an_empty_profile_list_is_a_warning_and_means_every_profile() {
        let meta = meta("# /// gedit\n# name = \"x\"\n# profiles = []\n# ///\n");
        assert_eq!(meta.profiles, None);
        assert_eq!(meta.warnings.len(), 1);
    }

    #[test]
    fn refuses_a_timeout_outside_the_supported_range() {
        for timeout in ["0", "-1", "999999999"] {
            let source = format!("# /// gedit\n# name = \"x\"\n# timeout = {timeout}\n# ///\n");
            assert!(!error(&source).is_empty(), "accepted timeout {timeout}");
        }
        assert_eq!(
            meta("# /// gedit\n# name = \"x\"\n# timeout = 86400\n# ///\n").timeout,
            Some(MAX_TIMEOUT_SECONDS)
        );
    }

    #[test]
    fn refuses_an_empty_name() {
        assert_eq!(
            error("# /// gedit\n# name = \"  \"\n# ///\n"),
            "`name` must not be empty"
        );
        assert!(error("# /// gedit\n# output = \"replace\"\n# ///\n").contains("name"));
    }

    #[test]
    fn refuses_a_parameter_that_could_not_be_rendered_or_remembered() {
        let param =
            |body: &str| format!("# /// gedit\n# name = \"x\"\n# [[params]]\n{body}# ///\n");
        for (body, expected) in [
            (
                "# id = \"2nd\"\n# label = \"L\"\n# type = \"text\"\n",
                "must be letters",
            ),
            (
                "# id = \"a b\"\n# label = \"L\"\n# type = \"text\"\n",
                "must be letters",
            ),
            (
                "# id = \"p\"\n# label = \" \"\n# type = \"text\"\n",
                "`label` must not be empty",
            ),
            (
                "# id = \"p\"\n# label = \"L\"\n# type = \"colour\"\n",
                "`type` must be one of",
            ),
            (
                "# id = \"p\"\n# label = \"L\"\n# type = \"choice\"\n",
                "needs a non-empty `choices` list",
            ),
            (
                "# id = \"p\"\n# label = \"L\"\n# type = \"number\"\n# min = 5\n# max = 1\n",
                "`min` is greater than `max`",
            ),
            (
                "# id = \"p\"\n# label = \"L\"\n# type = \"number\"\n# decimals = 42\n",
                "`decimals` must be at most",
            ),
        ] {
            let message = error(&param(body));
            assert!(message.contains(expected), "{message} for {body:?}");
        }
    }

    #[test]
    fn refuses_a_duplicate_parameter_id() {
        let message = error(concat!(
            "# /// gedit\n# name = \"x\"\n",
            "# [[params]]\n# id = \"p\"\n# label = \"A\"\n# type = \"text\"\n",
            "# [[params]]\n# id = \"p\"\n# label = \"B\"\n# type = \"text\"\n",
            "# ///\n"
        ));
        assert_eq!(message, "parameter `p` is declared twice");
    }

    /// A default of the wrong type reaches the script as-is, so it is refused here
    /// rather than crashing the script with a `TypeError` halfway through a program.
    #[test]
    fn refuses_a_default_that_does_not_match_the_type() {
        let param =
            |body: &str| format!("# /// gedit\n# name = \"x\"\n# [[params]]\n{body}# ///\n");
        for body in [
            "# id = \"p\"\n# label = \"L\"\n# type = \"number\"\n# default = \"100\"\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"integer\"\n# default = 1.5\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"bool\"\n# default = 1\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"text\"\n# default = 1\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"address-list\"\n# default = \"XYZ\"\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"choice\"\n# default = \"c\"\n# choices = [{ label = \"A\", value = \"a\" }]\n",
        ] {
            let message = error(&param(body));
            assert!(message.contains("`default`"), "{message} for {body:?}");
        }
        // And accepts the matching ones.
        for body in [
            "# id = \"p\"\n# label = \"L\"\n# type = \"number\"\n# default = 1.5\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"integer\"\n# default = 2\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"bool\"\n# default = true\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"text\"\n# default = \"F\"\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"address-list\"\n# default = [\"X\", \"Y\"]\n",
            "# id = \"p\"\n# label = \"L\"\n# type = \"choice\"\n# default = \"a\"\n# choices = [{ label = \"A\", value = \"a\" }]\n",
        ] {
            assert_eq!(meta(&param(body)).params.len(), 1, "{body:?}");
        }
    }

    /// CRLF files, a bare `#` for a blank TOML line, and indentation after the marker.
    #[test]
    fn tolerates_crlf_bare_hashes_and_indentation() {
        let meta = meta("# /// gedit\r\n#   name = \"x\"\r\n#\r\n# envelope = true\r\n# ///\r\n");
        assert_eq!(meta.name, "x");
        assert!(meta.envelope);
    }
}
