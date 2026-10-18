import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  label: string;
  /** Names already in use (registry or registered), compared trimmed and case-insensitive. */
  existingNames: readonly string[];
  /** Adds the player. Returns an error message to show under the input, or null on success. */
  onAdd: (name: string) => Promise<string | null> | string | null;
};

/**
 * A name input that adds on Enter and keeps the focus, so names can be typed one after another.
 * A name that already exists needs a second Enter (or "Add anyway"); names may legitimately repeat.
 */
export function NameEntry({ label, existingNames, onAdd }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [value, setValue] = useState('');
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(confirmed: boolean) {
    const name = value.trim();
    if (name === '' || busy.current) {
      return;
    }
    const lower = name.toLocaleLowerCase();
    const exists = existingNames.some((existing) => existing.trim().toLocaleLowerCase() === lower);
    if (exists && !confirmed && duplicate === null) {
      setDuplicate(name);
      return;
    }
    busy.current = true;
    const failure = await onAdd(name);
    busy.current = false;
    setError(failure);
    if (failure === null) {
      setValue('');
      setDuplicate(null);
    }
    inputRef.current?.focus();
  }

  return (
    <Stack gap={4}>
      <TextInput
        ref={inputRef}
        label={label}
        value={value}
        maxLength={100}
        error={error}
        onChange={(event) => {
          // Editing the text clears the warning and the last error.
          setValue(event.currentTarget.value);
          setDuplicate(null);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void add(false);
          }
        }}
      />
      {duplicate !== null && (
        <Group gap="xs" role="status">
          <Text size="sm" c="orange.8">
            {t('tournament.registration.duplicate', { name: duplicate })}
          </Text>
          <Button size="compact-xs" variant="light" color="orange" onClick={() => void add(true)}>
            {t('tournament.registration.addAnyway')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
