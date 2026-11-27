import { translateCommanderOrder, translateWorldLabel } from './localization';
import type { GameLanguage } from './localization';

export type RadioCall =
  | { kind: 'ready' }
  | { kind: 'contact' | 'support' | 'warning' | 'dispatch'; place: string; count: number }
  | { kind: 'gateClosing' | 'gateOpening'; place: string }
  | { kind: 'fallback'; line: number; order: string };

export interface RadioTransmission {
  call: RadioCall;
  time: number;
  unit: { id: number; isSwat: boolean } | null;
}

export function describeRadio({ call, unit }: RadioTransmission, language: GameLanguage) {
  const zh = language === 'zh';
  const speaker = unit
    ? zh ? `${unit.isSwat ? '特警' : '巡逻'} ${unit.id}` : `${unit.isSwat ? 'SWAT' : 'Patrol'} ${unit.id}`
    : zh ? '调度中心' : 'Dispatch';
  const place = 'place' in call ? (zh ? translateWorldLabel(call.place) : call.place) : '';
  let text: string;
  switch (call.kind) {
    case 'ready':
      text = zh ? '各单位，频道已开启。有情况请报告。' : 'All units, channel is open. Report any activity.';
      break;
    case 'contact':
      text = zh ? `${place}发现 ${call.count} 名感染者，我们在盯着。` : `${place}: ${call.count} infected spotted. We're watching them.`;
      break;
    case 'support':
      text = zh ? `${place}有 ${call.count} 名感染者，我们人手不够，请求支援！` : `${place}: ${call.count} infected. We're outnumbered. Requesting backup!`;
      break;
    case 'warning': {
      const isLabPlace = /^Zone \d/i.test(call.place);
      if (isLabPlace) {
        text = zh
          ? `${place}的工作人员，立即撤离走廊！附近有 ${call.count} 名感染者！`
          : `Personnel in ${place}, evacuate the corridor! ${call.count} infected nearby!`;
      } else {
        text = zh
          ? `${place}的平民，快离开街道！附近有 ${call.count} 名感染者！`
          : `Civilians in ${place}, get off the street! ${call.count} infected nearby!`;
      }
      break;
    }
    case 'dispatch':
      text = zh ? `收到。已派出 ${call.count} 名队员前往${place}。` : `Copy. ${call.count} responders assigned to ${place}.`;
      break;
    case 'gateClosing':
      text = zh ? `${place}正在关闭，所有人离开闸门！` : `${place} is closing. Clear the gate!`;
      break;
    case 'gateOpening':
      text = zh ? `${place}附近暂时安全，正在重新开启。` : `${place} is clear for now. Reopening the gate.`;
      break;
    case 'fallback':
      text = zh
        ? `第 ${call.line} 道防线失守。${translateCommanderOrder(call.order)}！`
        : `Line ${call.line} has been breached. ${call.order}!`;
      break;
  }
  return { speaker, text };
}
