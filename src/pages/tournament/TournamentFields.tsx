import { NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm, type UseFormReturnType } from '@mantine/form';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FormatSchema, type Format } from '../../domain';

/** Fields shared by the create form and the inline details edit. */
export type TournamentFormValues = {
  name: string;
  date: string | null; // YYYY-MM-DD
  location: string;
  format: Format | null;
  rounds: 'auto' | 'custom';
  customRounds: number | string; // NumberInput gives '' when cleared
};

export type TournamentField = 'name' | 'date' | 'location' | 'format' | 'swissRounds';

export type TournamentForm = UseFormReturnType<TournamentFormValues>;

/** `swissRounds` as stored: `null` for "Auto". Call only on validated values. */
export function swissRoundsOf(values: TournamentFormValues): number | null {
  return values.rounds === 'auto' ? null : Number(values.customRounds);
}

export function useTournamentForm(initialValues: TournamentFormValues): TournamentForm {
  const { t } = useTranslation();
  return useForm<TournamentFormValues>({
    initialValues,
    validate: {
      name: (value) => {
        const name = value.trim();
        if (name.length === 0) {
          return t('tournament.form.errors.nameRequired');
        }
        return name.length > 100 ? t('tournament.form.errors.tooLong') : null;
      },
      date: (value) => (value ? null : t('tournament.form.errors.dateRequired')),
      location: (value) => (value.trim().length > 100 ? t('tournament.form.errors.tooLong') : null),
      format: (value) => (value ? null : t('tournament.form.errors.formatRequired')),
      customRounds: (value, values) =>
        values.rounds === 'custom' &&
        !(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20)
          ? t('tournament.form.errors.rounds')
          : null,
    },
  });
}

type Props = {
  form: TournamentForm;
  /** Fields that cannot change in the current status. */
  disabled?: Partial<Record<TournamentField, boolean>>;
  /** "Auto" is only allowed before round 1 is paired. */
  autoDisabled?: boolean;
  /** Rendered below the swiss rounds field. */
  roundsExtra?: ReactNode;
};

export function TournamentFields({
  form,
  disabled = {},
  autoDisabled = false,
  roundsExtra,
}: Props) {
  const { t } = useTranslation();
  const roundsLabelId = useId();

  return (
    <>
      <TextInput
        label={t('tournament.form.name')}
        required
        maxLength={100}
        disabled={disabled.name}
        {...form.getInputProps('name')}
      />
      <DatePickerInput
        label={t('tournament.form.date')}
        required
        disabled={disabled.date}
        {...form.getInputProps('date')}
      />
      <TextInput
        label={t('tournament.form.location')}
        maxLength={100}
        disabled={disabled.location}
        {...form.getInputProps('location')}
      />
      <Select
        label={t('tournament.form.format')}
        placeholder={t('tournament.form.formatPlaceholder')}
        required
        disabled={disabled.format}
        data={FormatSchema.options.map((format) => ({
          value: format,
          label: t(`formats.${format}`),
        }))}
        {...form.getInputProps('format')}
      />

      <Stack gap={4}>
        <Text size="sm" fw={500} id={roundsLabelId}>
          {t('tournament.form.swissRounds')}
        </Text>
        <SegmentedControl
          aria-labelledby={roundsLabelId}
          disabled={disabled.swissRounds}
          data={[
            { value: 'auto', label: t('tournament.form.roundsAuto'), disabled: autoDisabled },
            { value: 'custom', label: t('tournament.form.roundsCustom') },
          ]}
          {...form.getInputProps('rounds')}
        />
        {form.values.rounds === 'custom' && (
          <NumberInput
            label={t('tournament.form.roundsCount')}
            min={1}
            max={20}
            allowDecimal={false}
            disabled={disabled.swissRounds}
            {...form.getInputProps('customRounds')}
          />
        )}
        {roundsExtra}
      </Stack>
    </>
  );
}
