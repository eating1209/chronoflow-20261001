import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import type {
  PlaceSelection,
  RecurrenceSelection,
  ReminderSelection,
  ReminderSoundChoice,
} from '../modules/calendar/pure';
import { DEFAULT_REMINDER_SOUND } from '../shared/notifications';

/**
 * 编辑页与三个二级选择页之间的「回传」状态。
 *
 * <p>为什么需要这一组状态：地点 / 重复 / 提醒都是**栈里的整页**（push 出去、选完 pop 回来），
 * 而下面的编辑页一直活着。选完的结果没法通过导航参数回传，所以用一份共享状态承接，
 * 并用 `version` 表达「又选了一次」——只有 version 变了编辑页才消费，避免重复应用。
 *
 * <p>这组状态被 4 个编辑页共用（日程新建 / 日程编辑 / 待办新建 / 待办编辑），
 * 所以必须放在它们共同的父级。原来直接写在 `App.tsx` 的 `MainStack` 里，
 * 与导航树的 600 行混在一起；抽到这里后，「重置回传」这件事只有一处定义。
 *
 * <p>**每次进编辑页前都要 `reset()`**：否则上一次选的地点 / 重复规则会串到下一个编辑页，
 * 用户会看到「新建的日程带着别人的地点」。
 */
export interface EditorSelections {
  place: PlaceSelection;
  recurrence: RecurrenceSelection;
  reminder: ReminderSelection;
  setPlace: Dispatch<SetStateAction<PlaceSelection>>;
  setRecurrence: Dispatch<SetStateAction<RecurrenceSelection>>;
  setReminder: Dispatch<SetStateAction<ReminderSelection>>;
  /** 进编辑页前调用：把三份选择都清空（version 归零） */
  reset: () => void;
}

const EMPTY_PLACE: PlaceSelection = { version: 0, place: null };
const EMPTY_RECURRENCE: RecurrenceSelection = { version: 0, recurrence: null };
const EMPTY_REMINDER: ReminderSelection = {
  version: 0,
  minutes: [],
  sound: DEFAULT_REMINDER_SOUND,
};

export function useEditorSelections(defaultReminderSound: ReminderSoundChoice): EditorSelections {
  const [place, setPlace] = useState<PlaceSelection>(EMPTY_PLACE);
  const [recurrence, setRecurrence] = useState<RecurrenceSelection>(EMPTY_RECURRENCE);
  const [reminder, setReminder] = useState<ReminderSelection>(() => ({
    ...EMPTY_REMINDER,
    sound: defaultReminderSound,
  }));

  // reset 用 useCallback 固定引用：它被传给每个导航回调，引用变了会让它们全部重建
  const reset = useCallback(() => {
    setPlace(EMPTY_PLACE);
    setRecurrence(EMPTY_RECURRENCE);
    setReminder({ version: 0, minutes: [], sound: defaultReminderSound });
  }, [defaultReminderSound]);

  return {
    place,
    recurrence,
    reminder,
    setPlace,
    setRecurrence,
    setReminder,
    reset,
  };
}
