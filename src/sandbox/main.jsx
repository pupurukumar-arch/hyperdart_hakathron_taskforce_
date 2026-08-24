import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client'; 
import { HDSandbox } from '@hyperdart/sandbox';
import hDConfig from '../../hyperdart.config';
import defaultSearchData from '../../searchData.json';

const container = document.getElementById('root');
const root = createRoot(container); 
root.render(<HDSandbox config={hDConfig} searchData={defaultSearchData} />);