import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {RootState} from '../..';

export interface AnnotatorState {
  isOpen: boolean;
}

const initialState: AnnotatorState = {
  isOpen: false,
};

export const annotatorSlice = createSlice({
  name: 'annotator',
  initialState,
  reducers: {
    setAnnotatorOpen: {
      reducer: (state, action: PayloadAction<boolean>) => {
        state.isOpen = action.payload;
      },
      prepare: (isOpen: boolean) => ({payload: isOpen}),
    },
  },
});

export const {setAnnotatorOpen} = annotatorSlice.actions;
export const selectIsAnnotatorOpen = (state: RootState) => state.annotator.isOpen;

export default annotatorSlice.reducer;
