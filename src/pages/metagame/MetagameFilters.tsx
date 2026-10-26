import { Group, Select } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useTranslation } from 'react-i18next';
import { FormatSchema, type Format, type IsoDate } from '../../domain';

export type FilterChange =
  { name: 'format'; value: Format } | { name: 'from' | 'to'; value: IsoDate | null };

/** Format and date range of the metagame page. The page keeps the values in the URL query. */
export function MetagameFilters({
  format,
  from,
  to,
  onChange,
}: {
  format: Format;
  from: IsoDate | null;
  to: IsoDate | null;
  onChange: (change: FilterChange) => void;
}) {
  const { t } = useTranslation();
  return (
    <Group align="flex-end">
      <Select
        label={t('metagame.filters.format')}
        allowDeselect={false}
        data={FormatSchema.options.map((value) => ({ value, label: t(`formats.${value}`) }))}
        value={format}
        onChange={(value) => {
          const parsed = FormatSchema.safeParse(value);
          if (parsed.success) {
            onChange({ name: 'format', value: parsed.data });
          }
        }}
      />
      <DateInput
        label={t('metagame.filters.from')}
        valueFormat="YYYY-MM-DD"
        clearable
        value={from}
        onChange={(value) => onChange({ name: 'from', value })}
      />
      <DateInput
        label={t('metagame.filters.to')}
        valueFormat="YYYY-MM-DD"
        clearable
        value={to}
        onChange={(value) => onChange({ name: 'to', value })}
      />
    </Group>
  );
}
