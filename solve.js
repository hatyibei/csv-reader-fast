// A fast drop-in replacement for csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors} under the same broken-row policy — BOM dropped, records
// end at LF or CRLF, blank lines are no record, a lone CR outside quotes is
// dropped (stray_cr), a quoted field runs to its closing quote with "" read as
// one quote and CR/CRLF inside read as LF, junk after a closing quote is
// appended as it stands (quote_junk), a quote that never closes is literal and
// its text is re-read as unquoted (unterminated_quote), and every row is padded
// (short_row) or cut (long_row) to the first record's width.
//
// Where the reference builds each field a character at a time, this reader
// scans by char code and cuts each field out of the text with slice, keeping a
// list of segments only for the fields that actually contain something to
// rewrite (a stray CR, a doubled quote, a CR inside quotes). The common field
// costs one scan and one slice.

const END = 0;
const COMMA = 1;
const BREAK = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1; // a BOM at the very start is dropped

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  // The field most recently read, shared instead of returned in an object.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0; // characters kept by the last unquoted read (quote_junk test)

  // Forward caches for the indexOf fast paths below: commaIdx holds the
  // first ',' at or after commaFrom (-2: not computed yet), and likewise for
  // LF and CR. pos moves forward only, except when an unterminated quote
  // resets it to an earlier spot; a cache made from a later start then fails
  // its check and is recomputed. Without these, a text with no CR at all
  // would make every field rescan the whole tail for one.
  let commaIdx = -2;
  let commaFrom = -1;
  let lfIdx = -2;
  let lfFrom = -1;
  let crIdx = -2;
  let crFrom = -1;

  // Reads unquoted characters onto `prefix` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr).
  function readUnquoted(prefix) {
    // Fast path: when no CR stands between here and the field's end, the
    // field is one slice of the text. Native indexOf finds the end far
    // quicker than the character scan below, which stays for the CR cases.
    {
      if (commaIdx === -2 || commaFrom > pos || (commaIdx !== -1 && commaIdx < pos)) {
        commaFrom = pos;
        commaIdx = text.indexOf(',', pos);
      }
      if (lfIdx === -2 || lfFrom > pos || (lfIdx !== -1 && lfIdx < pos)) {
        lfFrom = pos;
        lfIdx = text.indexOf('\n', pos);
      }
      if (crIdx === -2 || crFrom > pos || (crIdx !== -1 && crIdx < pos)) {
        crFrom = pos;
        crIdx = text.indexOf('\r', pos);
      }
      const cIdx = commaIdx;
      const nIdx = lfIdx;
      let end;
      let term;
      if (cIdx === -1 && nIdx === -1) {
        end = n;
        term = END;
      } else if (nIdx === -1 || (cIdx !== -1 && cIdx < nIdx)) {
        end = cIdx;
        term = COMMA;
      } else {
        end = nIdx;
        term = BREAK;
      }
      const rIdx = crIdx;
      if (rIdx === -1 || rIdx >= end) {
        fValue = prefix + text.slice(pos, end);
        fAdded = end - pos;
        if (term === COMMA) {
          pos = end + 1;
          fEnded = COMMA;
        } else if (term === BREAK) {
          pos = end + 1;
          line += 1;
          fEnded = BREAK;
        } else {
          pos = n;
          fEnded = END;
        }
        return;
      }
      if (term === BREAK && rIdx === end - 1) {
        // The field ends at a CRLF: the CR is the break's, not a stray.
        fValue = prefix + text.slice(pos, end - 1);
        fAdded = end - 1 - pos;
        pos = end + 1;
        line += 1;
        fEnded = BREAK;
        return;
      }
    }
    const start = pos;
    let segStart = pos;
    let parts = null;
    let added = 0;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ,
        if (parts === null) {
          fValue = prefix + text.slice(segStart, pos);
          fAdded = pos - start;
        } else {
          parts.push(text.slice(segStart, pos));
          fValue = prefix + parts.join('');
          fAdded = added + pos - segStart;
        }
        pos += 1;
        fEnded = COMMA;
        return;
      }
      if (c === 10) { // LF
        if (parts === null) {
          fValue = prefix + text.slice(segStart, pos);
          fAdded = pos - start;
        } else {
          parts.push(text.slice(segStart, pos));
          fValue = prefix + parts.join('');
          fAdded = added + pos - segStart;
        }
        pos += 1;
        line += 1;
        fEnded = BREAK;
        return;
      }
      if (c === 13) { // CR
        if (text.charCodeAt(pos + 1) === 10) { // CRLF ends the record
          if (parts === null) {
            fValue = prefix + text.slice(segStart, pos);
            fAdded = pos - start;
          } else {
            parts.push(text.slice(segStart, pos));
            fValue = prefix + parts.join('');
            fAdded = added + pos - segStart;
          }
          pos += 2;
          line += 1;
          fEnded = BREAK;
          return;
        }
        // A lone CR is dropped where it stands.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, pos));
        added += pos - segStart;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    if (parts === null) {
      fValue = prefix + text.slice(segStart, pos);
      fAdded = pos - start;
    } else {
      parts.push(text.slice(segStart, pos));
      fValue = prefix + parts.join('');
      fAdded = added + pos - segStart;
    }
    fEnded = END;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let segStart = pos;
    let parts = null;
    let value = null;
    // Fast path: when the body's only special characters are doubled quotes
    // and it holds no CR, the value is one slice of the text (or one slice
    // per doubled quote); only its LFs still count toward the line. A CR in
    // the body discards this attempt and takes the scan below — nothing here
    // has moved pos or line yet, so falling back is free.
    {
      if (crIdx === -2 || crFrom > pos || (crIdx !== -1 && crIdx < pos)) {
        crFrom = pos;
        crIdx = text.indexOf('\r', pos);
      }
      let scan = pos;
      let seg = pos;
      let segs = null;
      while (true) {
        const q = text.indexOf('"', scan);
        if (q === -1) {
          // No quote at all ahead: this quote never closes.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          readUnquoted('"');
          return;
        }
        if (text.charCodeAt(q + 1) === 34) { // "" is one quote: keep looking
          if (segs === null) segs = [];
          segs.push(text.slice(seg, q), '"');
          scan = q + 2;
          seg = scan;
          continue;
        }
        if (crIdx !== -1 && crIdx < q) break; // a CR in the body: scan below
        let lf = text.indexOf('\n', pos);
        while (lf !== -1 && lf < q) {
          line += 1;
          lf = text.indexOf('\n', lf + 1);
        }
        if (segs === null) {
          value = text.slice(pos, q);
        } else {
          segs.push(text.slice(seg, q));
          value = segs.join('');
        }
        pos = q + 1;
        break;
      }
    }
    while (value === null && pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) { // "
        if (text.charCodeAt(pos + 1) === 34) { // "" is one quote
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, pos), '"');
          pos += 2;
          segStart = pos;
          continue;
        }
        // The closing quote.
        if (parts === null) {
          value = text.slice(segStart, pos);
        } else {
          parts.push(text.slice(segStart, pos));
          value = parts.join('');
        }
        pos += 1;
        break;
      }
      if (c === 13) { // CRLF and a lone CR inside quotes are each one LF
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, pos), '\n');
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (c === 10) line += 1; // an LF inside quotes stays an LF in the value
      pos += 1;
    }
    if (value === null) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted, from the line the field opened on.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break; it is junk when it keeps any character.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
