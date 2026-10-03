import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { DateRuleDialog } from '../components/date-rule-dialog';
import { periodTemplates } from '../schemas/date-rule-schema';
import type { DateRule } from '../../inbox/schemas/inbox-schema';
import { messages as t } from '../../../shared/constants/messages';
import { ActionButton } from '../../../shared/components/action-button';

function draftRule(template?: { name: string; startDate: string; endDate: string }): DateRule {
  return {
    id: crypto.randomUUID(),
    name: template?.name ?? '',
    startDate: template?.startDate ?? '',
    endDate: template?.endDate ?? '',
    destinationPath: '',
    dateSource: 'modified',
    enabled: true,
  };
}
function displayDay(value: string) {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}
export function DateRulesView() {
  const { snapshot, busy, saveRules } = useWorkflowStore();
  const [draft, setDraft] = useState<DateRule | null>(null);
  const [removing, setRemoving] = useState<DateRule | null>(null);
  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h2">{t.rules}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t.rulesSubtitle}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRounded />}
          disabled={busy}
          onClick={() => setDraft(draftRule())}
        >
          {t.addRule}
        </Button>
      </Stack>
      <Box
        sx={{
          p: 2.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          borderRadius: 1.5,
          mb: 3,
        }}
      >
        <Typography variant="h3">{t.templates}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          {t.templateHint}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' },
            gap: 1.5,
          }}
        >
          {periodTemplates.map((template) => (
            <Button
              key={template.name}
              variant="outlined"
              disabled={busy}
              onClick={() => setDraft(draftRule(template))}
              sx={{
                p: 1.6,
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
              }}
            >
              <Box>
                <Typography fontWeight={600}>{template.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {displayDay(template.startDate)} → {displayDay(template.endDate)}
                </Typography>
              </Box>
              <AddRounded fontSize="small" color="primary" />
            </Button>
          ))}
        </Box>
      </Box>
      <Stack spacing={1.5}>
        {snapshot.rules.map((rule) => (
          <Box
            key={rule.id}
            sx={{
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              borderRadius: 1.3,
              p: 2.3,
              opacity: rule.enabled ? 1 : 0.65,
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    p: 1,
                    bgcolor: 'action.selected',
                    color: 'primary.light',
                    borderRadius: 1,
                    display: 'flex',
                  }}
                >
                  <CalendarMonthRounded />
                </Box>
                <Box>
                  <Typography variant="h3">{rule.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t.sourceLabels[rule.dateSource]}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Switch
                  size="small"
                  checked={rule.enabled}
                  disabled={busy}
                  slotProps={{ input: { 'aria-label': `${t.enabled}: ${rule.name}` } }}
                  onChange={(_, enabled) =>
                    void saveRules(
                      snapshot.rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
                    )
                  }
                />
                <ActionButton
                  label={`${t.editRule}: ${rule.name}`}
                  icon={EditOutlined}
                  disabled={busy}
                  onClick={() => setDraft(rule)}
                />
                <ActionButton
                  label={`${t.deleteRule}: ${rule.name}`}
                  icon={DeleteOutlineRounded}
                  disabled={busy}
                  onClick={() => setRemoving(rule)}
                />
              </Stack>
            </Stack>
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}
            >
              <Typography variant="body2">{displayDay(rule.startDate)}</Typography>
              <ArrowForwardRounded sx={{ fontSize: 15, color: 'text.secondary' }} />
              <Typography variant="body2">{displayDay(rule.endDate)}</Typography>
              <Typography variant="caption" color="text.disabled">
                · {t.destination}
              </Typography>
              <FolderOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography
                noWrap
                title={rule.destinationPath}
                variant="body2"
                color="text.secondary"
                sx={{ flex: 1, minWidth: 120 }}
              >
                {rule.destinationPath}
              </Typography>
            </Stack>
          </Box>
        ))}
      </Stack>
      {!snapshot.rules.length && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <CalendarMonthRounded sx={{ fontSize: 35, color: 'text.disabled', mb: 1 }} />
          <Typography variant="h3">{t.emptyRules}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t.emptyRulesBody}
          </Typography>
        </Box>
      )}
      <Alert severity="info" sx={{ mt: 3 }}>
        {t.rulesHint}
      </Alert>
      {draft && <DateRuleDialog key={draft.id} draft={draft} onClose={() => setDraft(null)} />}
      <Dialog open={!!removing} onClose={() => setRemoving(null)}>
        <DialogTitle>
          {t.deleteRule}
          {removing ? `: ${removing.name}` : ''}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{t.deleteRuleHint}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>{t.cancel}</Button>
          <Button
            color="error"
            disabled={busy}
            onClick={() => {
              if (removing)
                void saveRules(snapshot.rules.filter((r) => r.id !== removing.id)).then((saved) => {
                  if (saved) setRemoving(null);
                });
            }}
          >
            {t.deleteRule}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
