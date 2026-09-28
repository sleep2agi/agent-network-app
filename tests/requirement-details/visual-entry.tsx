import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Board from '../../src/RequirementBoard';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PeoplePicker from '../../src/RequirementPeoplePicker';
import type { RequirementPersonRef } from '../../src/requirement-people';

function PeopleFixture() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<RequirementPersonRef[]>([]);
  return <><button onClick={() => setOpen(true)}>选择参与人</button><output data-testid="people-result">{JSON.stringify(selected)}</output>{open ? <PeoplePicker networkId="fixture-network" mode="participants" selected={selected} people={[
    { kind: 'user', id: 'alex', name: 'Alex · 产品负责人', networkId: 'fixture-network' },
    { kind: 'node', id: 'alex', name: 'Alex · 研发 Agent', networkId: 'fixture-network' },
    { kind: 'node', id: 'review', name: '测试 Agent', networkId: 'fixture-network' },
  ]} onConfirm={people => { setSelected(people); setOpen(false); }} onClose={() => setOpen(false)} /> : null}</>;
}

createRoot(document.getElementById('root')!).render(<SafeAreaProvider>{location.search.includes('people=1') ? <PeopleFixture /> : <Board cfg={{ serverUrl: location.origin, token: 'fixture', networkId: 'fixture-network' }} />}</SafeAreaProvider>);
