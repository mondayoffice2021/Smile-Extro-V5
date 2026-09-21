import React from 'react';
import { countries } from '../constants/countries';
import GlobeAltIcon from './icons/GlobeAltIcon';

interface CountrySelectorProps {
  selectedCountry: string;
  setSelectedCountry: (country: string) => void;
  disabled?: boolean;
}

const CountrySelector: React.FC<CountrySelectorProps> = ({ selectedCountry, setSelectedCountry, disabled }) => {
  return (
    <div className="relative">
      <GlobeAltIcon className="pointer-events-none w-5 h-5 absolute top-1/2 transform -translate-y-1/2 left-3 text-gray-400" />
      <select
        value={selectedCountry}
        onChange={(e) => setSelectedCountry(e.target.value)}
        disabled={disabled}
        className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">Select a country</option>
        {countries.map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
      </select>
    </div>
  );
};

export default CountrySelector;
