"use client";

import React from 'react';

export const $ = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
export const pct = (n) => `${Math.round(n * 100)}%`;

export const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-stone-200/90 shadow-sm p-5 ${className}`}>{children}</div>
);

export const H = ({ children, sub }) => (
  <div className="mb-3">
    <h3 className="text-sm font-bold text-stone-900">{children}</h3>
    {sub && <p className="text-xs text-stone-500 mt-0.5">{sub}</p>}
  </div>
);
