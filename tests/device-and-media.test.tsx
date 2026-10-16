import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  detectMedia,
  mediaError,
  PHOTO_LIMIT,
  VIDEO_LIMIT,
} from '../src/lib/media';
import { devicePlatform } from '../src/lib/install';
import ActivityDetail from '../src/features/ActivityDetail';
import DeviceSettings from '../src/features/DeviceSettings';
import { emptyData, type Activity } from '../src/domain';
import ExecutionPhotos from '../src/features/ExecutionPhotos';
const mp4 = (brand = 'isom') => {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(24, 0);
  b.write('ftyp', 4);
  b.write(brand, 8);
  b.write('isom', 16);
  return b;
};
describe('evidências de foto ou vídeo', () => {
  it('verifica assinatura de MP4, MOV, WebM e imagens sem confiar na extensão', () => {
    expect(detectMedia(mp4())).toBe('video/mp4');
    expect(detectMedia(mp4('qt  '))).toBe('video/quicktime');
    expect(
      detectMedia(
        Uint8Array.from([
          0x1a,
          0x45,
          0xdf,
          0xa3,
          ...Buffer.from('webm-video-test'),
        ]),
      ),
    ).toBe('video/webm');
    expect(detectMedia(Buffer.from('um arquivo renomeado.mp4'))).toBeNull();
    expect(
      detectMedia(Buffer.from([255, 216, 255, ...Array(10).fill(0)])),
    ).toBe('image/jpeg');
  });
  it('aplica os limites distintos antes de armazenar ou enviar', () => {
    expect(mediaError({ type: 'video/mp4', size: VIDEO_LIMIT })).toBeNull();
    expect(mediaError({ type: 'video/mp4', size: VIDEO_LIMIT + 1 })).toMatch(
      /50 MB/,
    );
    expect(mediaError({ type: 'image/png', size: PHOTO_LIMIT + 1 })).toMatch(
      /10 MB/,
    );
    expect(mediaError({ type: 'video/mp4', size: 0 })).not.toBeNull();
    expect(mediaError({ type: 'text/html', size: 20 })).not.toBeNull();
  });
  it('oferece câmera de vídeo no campo único de evidências e reproduz vídeos recebidos', () => {
    const html = renderToStaticMarkup(
      <ExecutionPhotos
        photos={[]}
        evidence={[
          {
            id: 'v',
            activity_id: 'a',
            item_id: '__activity__',
            path: 'a/v',
            uploader: 'u',
            received_at: '2026-10-16T12:00:00Z',
            sha256: 'a'.repeat(64),
            mime_type: 'video/mp4',
            attempt: 1,
          },
        ]}
        attempt={1}
        editable
        onChange={vi.fn()}
        onError={vi.fn()}
        onView={vi.fn()}
      />,
    );
    expect(html).toContain('Adicionar vídeo');
    expect(html).toContain('video/mp4,video/quicktime,video/webm');
    expect(html).toContain('Vídeo');
    expect(html).toContain('50 MB');
  });
});
describe('início obrigatório e instalação', () => {
  const a: Activity = {
    id: 'a',
    unit_id: 'u',
    cycle_id: 'c',
    kind: 'inspection',
    title: 'Checkout',
    assignee: 'me',
    status: 'pending',
    priority: 'normal',
    due_at: '2026-10-16T15:30:00Z',
    occupancy: 2,
    items: [
      {
        id: 'cup',
        title: 'Copos',
        room: 'Geral',
        mode: 'count',
        expected: 4,
        required: true,
        evidence_required: false,
      },
    ],
    responses: {},
    revision: 0,
    attempt: 1,
    created_at: '2026-10-16T12:00:00Z',
  };
  const html = (activity: Activity, user = 'me') =>
    renderToStaticMarkup(
      <ActivityDetail
        activity={activity}
        user={user}
        data={emptyData}
        manager={false}
        busy={false}
        run={vi.fn()}
        onClose={vi.fn()}
        unitName={() => 'Unidade'}
        person={() => 'Colaborador'}
      />,
    );
  it('cobre o checklist pendente e impede a interação por teclado antes de iniciar', () => {
    const pending = html(a);
    expect(pending).toContain('execution-start-overlay');
    expect(pending).toContain('inert=""');
    expect(pending).toContain('Iniciar ordem de serviço');
    expect(pending.match(/Iniciar ordem de serviço/g)).toHaveLength(1);
    expect(html({ ...a, status: 'in_progress' })).not.toContain(
      'execution-start-overlay',
    );
  });
  it('informa quando a ordem deve ser iniciada pelo responsável e não oferece início a outra pessoa', () => {
    const pending = html(a, 'other');
    expect(pending).toContain('Aguardando Colaborador iniciar');
    expect(pending).not.toContain('Iniciar ordem de serviço');
  });
  it('identifica iPhone, iPad em modo desktop e Android para instruções de instalação', () => {
    expect(devicePlatform('iPhone')).toBe('ios');
    expect(devicePlatform('Macintosh', 5)).toBe('ios');
    expect(devicePlatform('Macintosh', 0)).toBe('desktop');
    expect(devicePlatform('Android')).toBe('android');
  });
  it('mantém instalação e permissão de notificações como ações explícitas do usuário', () => {
    const settings = renderToStaticMarkup(<DeviceSettings />);
    expect(settings).toContain('Instalar aplicativo');
    expect(settings).toContain('Ativar notificações');
    expect(settings).toContain('Conferir novamente');
  });
});
