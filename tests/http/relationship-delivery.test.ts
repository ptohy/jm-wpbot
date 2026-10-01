import { describe, expect, it } from 'vitest';
import { renderRelationshipIntent } from '../../apps/server/src/http/relationship-delivery.js';
import {
  extractRelationshipAction,
  extractStatuses,
} from '../../apps/server/src/http/meta-webhook.js';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222';

describe('relationship delivery contracts', () => {
  it('renders service-return WhatsApp actions with canonical service context', () => {
    const payload = renderRelationshipIntent({
      intentId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'return-1',
      organizationId: '44444444-4444-4444-8444-444444444444',
      channel: 'whatsapp',
      destination: '5521999999999',
      templateKey: 'service-return-reminder',
      templateVariables: {
        serviceId: SERVICE_ID,
        serviceName: 'Sobrancelha com henna',
      },
    }) as any;

    expect(payload.type).toBe('interactive');
    expect(payload.interactive.body.text).toContain('Sobrancelha com henna');
    expect(payload.interactive.action.buttons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reply: {
            id: `relationship_return_slots:${SERVICE_ID}`,
            title: 'Ver horários',
          },
        }),
        expect.objectContaining({
          reply: {
            id: 'relationship_later',
            title: 'Outro dia',
          },
        }),
      ]),
    );
  });

  it('renders package-renewal action bound to the exact package', () => {
    const payload = renderRelationshipIntent({
      intentId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'renewal-1',
      organizationId: '44444444-4444-4444-8444-444444444444',
      channel: 'whatsapp',
      destination: '5521999999999',
      templateKey: 'package-renewal-offer',
      templateVariables: {
        packageId: PACKAGE_ID,
        packageName: 'Sobrancelha com henna — 3 sessões',
        remainingSessions: 1,
      },
    }) as any;

    expect(payload.interactive.body.text).toContain('1 sessão restante');
    expect(payload.interactive.action.buttons[0].reply).toEqual({
      id: `relationship_package_renew:${PACKAGE_ID}`,
      title: 'Renovar pacote',
    });
  });

  it('parses relationship buttons without accepting malformed ids', () => {
    expect(
      extractRelationshipAction({
        interactive: {
          button_reply: {
            id: `relationship_return_slots:${SERVICE_ID}`,
          },
        },
      }),
    ).toEqual({ kind: 'return_slots', serviceId: SERVICE_ID });

    expect(
      extractRelationshipAction({
        button: {
          payload: `relationship_package_renew:${PACKAGE_ID}`,
        },
      }),
    ).toEqual({ kind: 'package_renew', packageId: PACKAGE_ID });

    expect(
      extractRelationshipAction({
        interactive: {
          button_reply: {
            id: 'relationship_package_renew:not-a-uuid',
          },
        },
      }),
    ).toBeNull();
  });

  it('extracts only terminal Meta delivery states and normalizes error codes', () => {
    const statuses = extractStatuses({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.sent', status: 'sent' },
                  { id: 'wamid.ok', status: 'delivered' },
                  {
                    id: 'wamid.fail',
                    status: 'failed',
                    errors: [{ code: 131026 }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(statuses).toEqual([
      { id: 'wamid.ok', status: 'delivered' },
      {
        id: 'wamid.fail',
        status: 'failed',
        errorCode: 'meta_131026',
      },
    ]);
  });
});
