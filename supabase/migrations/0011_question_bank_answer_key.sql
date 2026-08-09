-- U2 / R1 / R2 / R3 / KTD2. Answer anchor for cross-game duplicate detection.
--
-- Dedup so far has been exact-match on prompt_norm, which a paraphrase defeats
-- ("What is the capital of France?" vs "Which city is France's capital?"). The
-- new rule is answer-anchored: a candidate is only *suspect* when its correct
-- answer matches a banked question's, and only those few rows are then compared
-- on prompt similarity. This column is that anchor.
--
-- Deliberately NOT unique, unlike prompt_norm: R2 requires that two genuinely
-- different questions may share an answer across games ("Which city hosts the
-- Louvre?" and "What is the capital of France?" are both "Paris", and both are
-- keepers). Uniqueness here would reject exactly the case the rule protects.
--
-- Nullable by design. A row whose answer key can't be derived (malformed
-- correct_option, empty variants) stores null, never anchors a match, and so
-- degrades to the old prompt-only behavior rather than failing or — worse —
-- collapsing every malformed row onto a shared empty key.

alter table public.question_bank
  add column if not exists answer_norm text;

-- One-time backfill of rows banked before this column existed.
--
-- The expression mirrors normalizePrompt/normalizeAnswer in
-- lib/generation/dedup.ts: lowercase, every non-alphanumeric character becomes a
-- space (so "co-operate" and "cooperate" stay distinct rather than colliding),
-- runs of whitespace collapse, ends trimmed. Postgres [:alnum:] is locale-aware
-- under a UTF-8 database, matching the JS \p{L}\p{N} classes for every realistic
-- answer.
--
-- Application code is the authority for every write from here on:
-- normalizedAnswerKey() in lib/generation/answerKey.ts computes this on insert,
-- so this SQL runs once and is never the ongoing source of truth. A legacy row
-- that normalizes differently at the margins simply fails to anchor — the same
-- benign degradation as a null.
update public.question_bank
set answer_norm = nullif(
  btrim(
    regexp_replace(
      regexp_replace(
        lower(
          case
            -- Postgres arrays are 1-based; correct_option is a 0-based index.
            when mode = 'multiple_choice'
              and options is not null
              and correct_option is not null
              and correct_option >= 0
              and correct_option < array_length(options, 1)
              then options[correct_option + 1]
            when mode = 'type_answer'
              and accepted_variants is not null
              and array_length(accepted_variants, 1) >= 1
              then accepted_variants[1]
            else null
          end
        ),
        '[^[:alnum:][:space:]]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  ),
  ''
)
where answer_norm is null;

-- Supports the candidate lookup in U4: "which banked questions share this
-- answer?". Non-unique per R2 above. Nulls are excluded — they can never match.
create index if not exists idx_question_bank_answer_norm
  on public.question_bank (answer_norm)
  where answer_norm is not null;

-- Supports the category-scoped bank read in U3 (array overlap, `&&`).
create index if not exists idx_question_bank_categories
  on public.question_bank using gin (categories);
